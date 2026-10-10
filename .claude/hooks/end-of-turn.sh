#!/usr/bin/env bash
# Stop: sweep everything this turn changed before the agent finishes, one retry.
#   code changed      -> ESLint on the changed files and `astro check` (in parallel), then the unit suite
#   supabase/ changed -> `supabase test db`, when local Supabase is up and every migration is applied
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook end-of-turn.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)

# Already sent back once by this hook: let it finish. The commit gate and CI catch the rest.
# (loop_count covers Cursor, which imports this hook from .claude/settings.json.)
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
LOOPS=$(printf '%s' "$INPUT" | jq -r '.loop_count // 0' 2>/dev/null)
if [ "$ACTIVE" = "true" ] || [ "${LOOPS:-0}" != "0" ]; then
  exit 0
fi

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
GREEN_MARKS=()
GREEN_FPS=()
for ROOT in "${ROOTS[@]}"; do
  cd "$ROOT" || continue

  # Changed and new files. Nothing changed (a Q&A turn): nothing to check here.
  CHANGED=$({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } 2>/dev/null | sort -u)
  [ -n "$CHANGED" ] || continue

  # Same tree as the last green sweep of this checkout: nothing new to check.
  FP=$({ git rev-parse HEAD; git diff HEAD; git ls-files -o --exclude-standard -z | xargs -0 -r sha1sum; } 2>/dev/null | sha1sum | cut -d' ' -f1)
  MARK="$STATE/green.$(printf '%s' "$ROOT" | sha1sum | cut -d' ' -f1)"
  [ "$(cat "$MARK" 2>/dev/null)" = "$FP" ] && continue

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
    if missing supabase; then
      :
    elif ! db_up; then
      SKIPPED="$SKIPPED pgTAP ($ROOT): local Supabase is not running, start it with \`npx supabase start\`;"
    else
      PENDING=$(node_modules/.bin/supabase migration list --local --output-format json 2>/dev/null </dev/null |
        jq -r '[.migrations[] | select((.remote // "") == "") | .local] | join(" ")' 2>/dev/null)
      if [ -n "$PENDING" ]; then
        # Applying migrations changes the local database the developer uses: not the hook's call.
        SKIPPED="$SKIPPED pgTAP ($ROOT): migration(s) $PENDING not applied locally, run \`npx supabase migration up --local\`;"
      else
        EDITED=$(git diff --name-only --diff-filter=M HEAD -- supabase/migrations 2>/dev/null | tr '\n' ' ')
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

  # Only a full pass counts as green: a skipped pgTAP run is retried next turn.
  if [ "$REPORT" = "$REPORT_ROOT_START" ] && [ "$SKIPPED" = "$SKIPPED_ROOT_START" ]; then
    GREEN_MARKS+=("$MARK")
    GREEN_FPS+=("$FP")
  fi
done

if [ -n "$REPORT" ]; then
  [ -n "$SKIPPED" ] && REPORT="$REPORT
Skipped on this host:$SKIPPED
"
  echo "Fix these before you finish:$REPORT" >&2
  exit 2
fi
# Green: remember the clean trees, and start the next turn with an empty registry.
mkdir -p "$STATE" 2>/dev/null
for i in "${!GREEN_MARKS[@]}"; do printf '%s\n' "${GREEN_FPS[$i]}" >"${GREEN_MARKS[$i]}" 2>/dev/null; done
[ -n "$SID" ] && : >"$REGISTRY" 2>/dev/null
[ -n "$SKIPPED" ] && jq -cn --arg m "end-of-turn.sh passed, but skipped on this host:$SKIPPED" '{systemMessage: $m}'
exit 0
