#!/usr/bin/env bash
# PostToolUse (Write|Edit): run the tests that depend on the file the agent just edited.
#   src/**/*.{ts,tsx,js,mjs}   -> the Vitest tests related to it (or the test file itself)
#   supabase/tests/*.sql       -> that pgTAP file, against local Supabase
# Exit 2 + stderr is the only combination Claude sees. ESLint (~45 s per file) and
# `astro check` (~50 s) are too slow per edit here; end-of-turn.sh runs them.
# Migrations are not applied here (that changes the local database); end-of-turn.sh
# runs pgTAP once they are.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook related-tests.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac
[ -f "$FILE" ] || exit 0

# Checkout of the edited file, not $CLAUDE_PROJECT_DIR (after EnterWorktree, or for a
# sibling worktree, that variable names another checkout). Files of other repositories
# (~/.claude, other projects) are skipped; any worktree of this repository is checked.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

# Register the checkout so the Stop hook sweeps it too, even when it is not the session cwd.
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
if [ -n "$SID" ] && mkdir -p "${TMPDIR:-/tmp}/claude-hooks"; then
  printf '%s\n' "$ROOT" >>"${TMPDIR:-/tmp}/claude-hooks/$SID.roots"
fi

REL=${FILE#"$ROOT"/}

# A tool that is not installed in this checkout fails visibly, never passes.
run() {
  if [ ! -x "node_modules/.bin/$1" ]; then
    echo "Hook related-tests.sh: node_modules/.bin/$1 is missing in $ROOT (run npm install there)." >&2
    exit 2
  fi
  local bin=$1
  shift
  OUTPUT=$("node_modules/.bin/$bin" "$@" 2>&1 </dev/null)
}

db_up() {
  local port
  port=$(awk '/^\[db\]/{f=1;next} /^\[/{f=0} f&&/^port *=/{print $3; exit}' supabase/config.toml 2>/dev/null)
  timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/${port:-54322}" 2>/dev/null
}

case "$REL" in
  src/*.test.ts|src/*.test.tsx)
    run vitest run "$REL" || { echo "Tests in $REL fail:" >&2; echo "$OUTPUT" >&2; exit 2; }
    ;;
  src/*.ts|src/*.tsx|src/*.js|src/*.mjs)
    run vitest related "$REL" --run || { echo "Tests related to $REL fail:" >&2; echo "$OUTPUT" >&2; exit 2; }
    ;;
  supabase/tests/*.sql)
    if ! db_up; then
      # Not silent: the user and the agent both learn the test did not run.
      MSG="related-tests.sh: local Supabase is not running, so $REL was not run. Start it with \`npx supabase start\`, then \`npx supabase test db $REL\`."
      jq -cn --arg m "$MSG" '{systemMessage: $m, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
      exit 0
    fi
    run supabase test db "$REL" || { echo "pgTAP $REL fails:" >&2; echo "$OUTPUT" >&2; exit 2; }
    ;;
esac
exit 0
