#!/usr/bin/env bash
# Migration replay: checks the newest migration over existing rows (docs/testing.md "Migration replay").
#
#   scripts/migration-replay.sh [base-version]
#
# Resets the local database to base-version (default: the second-newest file in supabase/migrations/),
# seeds it through the RPCs (supabase/replay/seed.sql), applies every later migration, then runs the
# snapshot checks (supabase/replay/checks.test.sql) and the full pgTAP suite over the seeded rows. Any
# failing step exits non-zero.
#
# An older base replays every migration after it, but only as far back as the seed's RPCs exist:
# 20261008180000 (rate_meal with the re-pick) is the oldest valid base. The default replays only the
# newest migration: with several new ones, pass the newest version on master as base-version.
#
# It wipes the local database, which `npm run dev` and other worktrees share, so it runs only with
# MIGRATION_REPLAY_WIPES_LOCAL_DB=1 (CI sets it on the replay step).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${MIGRATION_REPLAY_WIPES_LOCAL_DB:-}" != "1" ]; then
  cat >&2 <<'EOF'
migration-replay: refusing to run. It resets the local Supabase database, wiping every row that
`npm run dev`, the smoke test and other worktrees use. Run it with MIGRATION_REPLAY_WIPES_LOCAL_DB=1
to accept that (the CI replay step sets it).
EOF
  exit 1
fi

oldest_base=20261008180000
versions=$(find supabase/migrations -maxdepth 1 -name '*.sql' -exec basename {} \; | sed -n 's/^\([0-9]\{14\}\)_.*\.sql$/\1/p' | sort)
if [ "$(printf '%s\n' "$versions" | grep -c .)" -lt 2 ]; then
  echo "migration-replay: needs at least two migrations in supabase/migrations/" >&2
  exit 1
fi

base=${1:-$(printf '%s\n' "$versions" | tail -n 2 | head -n 1)}
if ! [[ $base =~ ^[0-9]{14}$ ]]; then
  echo "migration-replay: base-version must be a 14-digit migration version, got '$base'" >&2
  exit 1
fi
if ! printf '%s\n' "$versions" | grep -qxF -- "$base"; then
  echo "migration-replay: no migration with version $base in supabase/migrations/" >&2
  exit 1
fi
if [ "$base" \< "$oldest_base" ]; then
  echo "migration-replay: base $base is older than $oldest_base; supabase/replay/seed.sql needs its RPCs" >&2
  exit 1
fi
replayed=$(printf '%s\n' "$versions" | awk -v base="$base" '$0 > base')
if [ -z "$replayed" ]; then
  echo "migration-replay: $base is the newest migration; nothing to replay" >&2
  exit 1
fi

echo "==> Replaying over seeded rows, from base $base:"
printf '%s\n' "$replayed" | sed 's/^/    /'

echo "==> 1/5 Reset the local database to $base"
npx supabase db reset --version "$base" --local

echo "==> 2/5 Seed through the RPCs and snapshot (supabase/replay/seed.sql)"
if command -v psql > /dev/null; then
  # CI's supabase.env doesn't keep DB_URL, so read it from status.
  db_url=$(npx supabase status -o env | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
  if [ -z "$db_url" ]; then
    echo "migration-replay: no DB_URL in \`npx supabase status -o env\`" >&2
    exit 1
  fi
  psql "$db_url" -X -q -o /dev/null -v ON_ERROR_STOP=1 -f supabase/replay/seed.sql
else
  project_id=$(sed -n 's/^project_id *= *"\([^"]*\)".*/\1/p' supabase/config.toml)
  if [ -z "$project_id" ]; then
    echo "migration-replay: no project_id in supabase/config.toml" >&2
    exit 1
  fi
  docker exec -i "supabase_db_$project_id" psql -U postgres -X -q -o /dev/null -v ON_ERROR_STOP=1 < supabase/replay/seed.sql
fi

echo "==> 3/5 Apply the migrations after $base"
npx supabase migration up --local

echo "==> 4/5 Snapshot checks (supabase/replay/checks.test.sql)"
# The file, not the directory: pg_prove would also run seed.sql as a test.
npx supabase test db supabase/replay/checks.test.sql

echo "==> 5/5 Full pgTAP suite over the seeded rows"
npx supabase test db

echo "==> Migration replay passed"
