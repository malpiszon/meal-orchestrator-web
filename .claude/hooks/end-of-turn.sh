#!/usr/bin/env bash
# Stop: sweep everything this turn changed before the agent finishes, one retry.
#   code changed      -> ESLint on the changed files and `astro check` (in parallel), then the unit suite
#   supabase/ changed -> new migrations applied (`migration up`, never a reset), then `supabase test db`
# A tree identical to the last sweep of its checkout is not checked again: green stays green,
# and red was already reported (an unrelated question must not re-run ~60 s of checks and
# send the agent back to work it was not asked to touch).
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook end-of-turn.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)

# Already sent back once by this hook: let it finish. The commit gate and CI catch the rest.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0

# Checkouts to sweep: the session's (payload cwd follows EnterWorktree, $CLAUDE_PROJECT_DIR
# does not) plus every checkout related-tests.sh registered for this session.
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
STATE="${TMPDIR:-/tmp}/claude-hooks"
REGISTRY="$STATE/${SID:-none}.roots"
ROOTS=()
while IFS= read -r r; do
  [ -n "$r" ] && [ -d "$r" ] && ROOTS+=("$r")
done <<EOF
$({ git -C "${CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null; [ -n "$SID" ] && cat "$REGISTRY" 2>/dev/null; } | sort -u)
EOF
if [ "${#ROOTS[@]}" -eq 0 ]; then
  # Not silent: the user sees why nothing was checked.
  jq -cn --arg m "end-of-turn.sh: no git checkout at ${CWD:-$PWD}, nothing checked." '{systemMessage: $m}'
  exit 0
fi
# Registered checkouts get this one sweep; a later turn sweeps them again only if the
# agent edits there again.
mkdir -p "$STATE" 2>/dev/null
[ -n "$SID" ] && [ -f "$REGISTRY" ] && : 2>/dev/null >"$REGISTRY"

TMP=$(mktemp -d) || { echo "Hook end-of-turn.sh: mktemp failed." >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT

db_up() {
  local port
  port=$(awk '/^\[db\]/{f=1;next} /^\[/{f=0} f&&/^port *=/{print $3; exit}' supabase/config.toml 2>/dev/null)
  timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/${port:-54322}" 2>/dev/null
}

# A tool that is not installed in a checkout fails visibly, never passes.
missing() {
  local b none=1
  for b in "$@"; do
    [ -x "node_modules/.bin/$b" ] && continue
    REPORT="$REPORT
node_modules/.bin/$b is missing in $ROOT (run npm install there).
"
    none=0
  done
  return $none
}

SKIPPED=""
REPORT=""
UNCHANGED_RED=""
DONE_MARKS=()
DONE_LINES=()
for ROOT in "${ROOTS[@]}"; do
  cd "$ROOT" || continue
  KEY=$(printf '%s' "$ROOT" | sha1sum | cut -d' ' -f1)

  # Changed and new files. Nothing changed (a Q&A turn): nothing to check here.
  CHANGED=$({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | sort -u)
  [ -n "$CHANGED" ] || continue

  # Same tree as the last sweep of this checkout: nothing new to check or report.
  FP=$({ git rev-parse HEAD; git diff HEAD; git ls-files -o --exclude-standard -z | xargs -0 -r sha1sum; } 2>/dev/null | sha1sum | cut -d' ' -f1)
  MARK="$STATE/sweep.$KEY"
  case "$(cat "$MARK" 2>/dev/null)" in
    "green $FP") continue ;;
    "red $FP") UNCHANGED_RED="$UNCHANGED_RED $ROOT;"; continue ;;
  esac

  # Classify. This also catches files rewritten through a shell command, which never
  # reach a per-edit hook. Lint list from eslint.config.js (js/ts/tsx/astro, scripts/*.mjs).
  LINT=()
  CODE=0
  DB=0
  while IFS= read -r f; do
    case "$f" in
      *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.astro) CODE=1; [ -f "$f" ] && LINT+=("$f") ;;
      package.json|package-lock.json|tsconfig.json) CODE=1 ;;
      supabase/migrations/*.sql|supabase/tests/*.sql|supabase/seed.sql) DB=1 ;;
    esac
  done <<EOF
$CHANGED
EOF

  REPORT_ROOT_START=$REPORT
  SKIPPED_ROOT_START=$SKIPPED
  if [ "$CODE" = 1 ]; then
    if ! missing eslint astro vitest; then
      # Type-checked ESLint and astro check take ~45 s each on this repo: run them side by side.
      if [ "${#LINT[@]}" -gt 0 ]; then
        node_modules/.bin/eslint --quiet --no-warn-ignored "${LINT[@]}" >"$TMP/eslint" 2>&1 </dev/null &
        P_LINT=$!
      fi
      node_modules/.bin/astro check --minimumSeverity error >"$TMP/astro" 2>&1 </dev/null &
      P_TYPES=$!
      if [ -n "${P_LINT:-}" ] && ! wait "$P_LINT"; then
        REPORT="$REPORT
ESLint errors in changed files ($ROOT):
$(cat "$TMP/eslint")
"
      fi
      unset P_LINT
      if ! wait "$P_TYPES"; then
        REPORT="$REPORT
astro check fails ($ROOT):
$(sed "s/\x1b\[[0-9;]*m//g" "$TMP/astro" | grep --color=never -vE '^\s*$|^[0-9:]{8} \[|^\(node:|^\(Use `node' | tail -n 80)
"
      fi
      # The whole unit suite takes ~3 s: it also catches a red test in a module this turn only imported.
      if ! OUT=$(node_modules/.bin/vitest run 2>&1 </dev/null); then
        REPORT="$REPORT
Unit tests fail ($ROOT):
$OUT
"
      fi
    fi
  fi

  if [ "$DB" = 1 ]; then
    APPLIED="$STATE/applied.$KEY"
    if missing supabase; then
      :
    elif ! db_up; then
      SKIPPED="$SKIPPED pgTAP ($ROOT): local Supabase is not running, start it with \`npx supabase start\`;"
    else
      PENDING=$(node_modules/.bin/supabase migration list --local --output-format json 2>/dev/null </dev/null |
        jq -r '[.migrations[] | select((.remote // "") == "") | .local] | join(" ")' 2>/dev/null)
      APPLY_OK=1
      # The agent has stopped editing for this turn: apply its new migrations so pgTAP sees
      # them. `migration up` only adds; it never resets the local database.
      if [ -n "$PENDING" ]; then
        if OUT=$(node_modules/.bin/supabase migration up --local 2>&1 </dev/null); then
          # Remember what was applied, to notice a later edit of a still-uncommitted migration.
          for v in $PENDING; do
            for f in supabase/migrations/"$v"_*.sql; do
              [ -f "$f" ] && printf '%s %s\n' "$f" "$(sha1sum <"$f" | cut -d' ' -f1)" >>"$APPLIED"
            done
          done
        elif printf '%s\n' "$OUT" | grep -qiE 'inserted before the last migration|migration versions not found'; then
          # The local database's history differs from this checkout (another worktree or
          # branch shares the stack). Not the agent's SQL to fix.
          APPLY_OK=0
          LINE=$(printf '%s\n' "$OUT" | grep -iE 'inserted before|versions not found' | head -n 1)
          # The CLI prints the error as JSON when stdout is not a terminal; keep only its message.
          WHY=$(printf '%s' "$LINE" | jq -r '.error.message // empty' 2>/dev/null)
          [ -n "$WHY" ] || WHY=$LINE
          SKIPPED="$SKIPPED pgTAP ($ROOT): the local database's migration history differs from this checkout (another worktree or branch?): $WHY;"
        else
          APPLY_OK=0
          REPORT="$REPORT
Applying migration(s) $PENDING to local Supabase fails ($ROOT):
$(printf '%s\n' "$OUT" | tail -n 40)
"
        fi
      fi
      if [ "$APPLY_OK" = 1 ]; then
        # Applied migrations edited since: tracked ones against HEAD, uncommitted ones
        # against what this hook applied. The database keeps the old version.
        EDITED=$(git diff --name-only --diff-filter=M HEAD -- supabase/migrations 2>/dev/null)
        while IFS= read -r f; do
          [ -n "$f" ] || continue
          was=$(awk -v f="$f" '$1==f{s=$2} END{print s}' "$APPLIED" 2>/dev/null)
          [ -n "$was" ] && [ "$was" != "$(sha1sum <"$f" | cut -d' ' -f1)" ] && EDITED="$EDITED
$f"
        done <<EOF
$(git ls-files -o --exclude-standard -- supabase/migrations 2>/dev/null)
EOF
        EDITED=$(printf '%s\n' "$EDITED" | grep -v '^$' | tr '\n' ' ')
        [ -n "$EDITED" ] && SKIPPED="$SKIPPED pgTAP ($ROOT) ran against the applied version of edited migration(s) ${EDITED% }; \`npx supabase db reset\` (wipes local data) applies the edit;"
        if ! OUT=$(node_modules/.bin/supabase test db 2>&1 </dev/null); then
          REPORT="$REPORT
pgTAP fails ($ROOT):
$(printf '%s\n' "$OUT" | grep --color=never -vE ' \.+ ok$' | tail -n 80)
"
        fi
      fi
    fi
  fi

  # Remember the result. A skipped part is not a result: that tree is checked again next turn.
  if [ "$REPORT" != "$REPORT_ROOT_START" ]; then
    DONE_MARKS+=("$MARK")
    DONE_LINES+=("red $FP")
  elif [ "$SKIPPED" = "$SKIPPED_ROOT_START" ]; then
    DONE_MARKS+=("$MARK")
    DONE_LINES+=("green $FP")
  fi
done

for i in "${!DONE_MARKS[@]}"; do printf '%s\n' "${DONE_LINES[$i]}" >"${DONE_MARKS[$i]}" 2>/dev/null; done

if [ -n "$REPORT" ]; then
  [ -n "$SKIPPED" ] && REPORT="$REPORT
Skipped on this host:$SKIPPED
"
  echo "Fix these before you finish:$REPORT" >&2
  exit 2
fi
NOTE=""
[ -n "$SKIPPED" ] && NOTE="end-of-turn.sh skipped on this host:$SKIPPED"
[ -n "$UNCHANGED_RED" ] && NOTE="${NOTE:+$NOTE }end-of-turn.sh: still red and unchanged since it was reported, not re-checked:$UNCHANGED_RED"
[ -n "$NOTE" ] && jq -cn --arg m "$NOTE" '{systemMessage: $m}'
exit 0
