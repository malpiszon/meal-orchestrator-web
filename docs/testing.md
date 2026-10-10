# Testing

| Layer            | Command                           | Where                                                     | Needs                                                                    |
| ---------------- | --------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Unit             | `npm test`                        | `src/**/*.test.ts`, `scripts/**/*.test.ts` (Vitest)       | Nothing (`bash`, `git`, `jq` for the agent-hook test)                    |
| Database         | `npx supabase test db`            | `supabase/tests/*.test.sql` (pgTAP)                       | Local Supabase running                                                   |
| Migration replay | `npm run test:replay`             | `scripts/migration-replay.sh`, `supabase/replay/` (pgTAP) | Local Supabase running, `psql` or `docker`; **wipes the local database** |
| Smoke (HTTP)     | `npm run smoke`                   | `scripts/smoke.mjs`                                       | A running server and Supabase, see below                                 |
| Lint and types   | `npm run lint`, `npx astro check` |                                                           | `npx astro sync` once, as CI does                                        |

## Database tests

Each `supabase/tests/*.test.sql` file runs in one transaction (`begin; select plan(N); … finish(); rollback;`) with its own fixed user UUIDs and emails, inserted into `auth.users`. A file acts as a user with `set local role authenticated` plus `set_config('request.jwt.claims', …, true)`, and sends MO deliveries as `set local role service_role`. Most files build their dates from the real Warsaw today; `date_boundaries.test.sql` pins it ([Pinning today](#pinning-today)). Besides the per-rule files:

- `rpc_contract.test.sql` pins every RPC the Worker calls (argument names and types, return type, EXECUTE grants) and the columns it reads, so a migration pushed before its code merges can't break the deployed Worker. A new or changed RPC adds its rows here.
- `warsaw_today.test.sql` pins `private.warsaw_date()` at Warsaw midnight in summer and winter time, and fails when any function in `public` or `private` derives a date without `private.warsaw_today()` (`at time zone`, `current_date`, `now()::date`, …). Every SQL date rule calls that helper.
- `date_boundaries.test.sql` checks the cut-off, the rating window, `week_started` and the late-rating re-pick at their boundary days, with today pinned.

Week selection on the dashboard and in history (`src/lib/services/plans.ts`) is unit-tested with fixed `today` strings against rows, through the in-memory PostgREST fake `src/test/fake-supabase.ts`. The fake throws on any builder method it doesn't implement.

### Pinning today

A test file pins "today" by replacing `private.warsaw_today()` inside its transaction, so the change is rolled back with the file:

```sql
begin;
select plan(N);

-- As postgres (the helper's owner), before any `set local role`, or after `reset role`.
create or replace function private.warsaw_today()
returns date
language sql
stable
set search_path = ''
as $$
  select date '2026-03-30';
$$;
```

Pin one date per file, at the top, and build every fixture date from it. Choose a date far from the real one: a function that bypasses the helper then fails on every run, not only near Warsaw midnight. Make the first assertion one the real date would answer differently, so it proves the pin took effect. Locally `postgres` isn't a superuser, so the replacement fails with "must be owner" under another role.

## Migration replay

`npm run test:replay` (`scripts/migration-replay.sh [base-version]`) checks the newest migration over existing rows:

1. `npx supabase db reset --version <base> --local`, where the base defaults to the second-newest file in `supabase/migrations/`;
2. loads `supabase/replay/seed.sql`, with `psql` against `DB_URL` from `npx supabase status -o env`, or, without `psql` on `PATH`, through `docker exec` into `supabase_db_<project_id>`. The seed creates two users and their history, current, saved and unsaved upcoming weeks and ratings through the RPCs only, then snapshots every slot, the chosen options of saved plans and started weeks, the ratings and each plan's `saved_at`, `week_start` and `week_end` into the `replay_snapshot` schema;
3. `npx supabase migration up --local`;
4. `npx supabase test db supabase/replay/checks.test.sql`: the snapshotted choices, ratings and plan dates are unchanged, and every slot is still there with exactly one chosen option;
5. `npx supabase test db`: the full suite, now over the seeded rows.

Any failing step exits non-zero. The reset **wipes the local database** shared with `npm run dev`, the smoke test and other worktrees, so the script refuses to run unless `MIGRATION_REPLAY_WIPES_LOCAL_DB=1` (the CI step sets it). Afterwards the local database is at the newest migration with only the seed rows, plus the `replay_snapshot` schema, which the next `db reset` removes; re-deliver a week to sign in again ([dev walkthrough](dev-walkthrough.md)).

With no argument only the newest migration runs over the seeded rows: a PR that adds several migrations should also run the script with the newest version on `master` as the base, as the reset applies the others before the seed. An older base replays every migration after it, but no further back than `20261008180000`: the seed calls the RPCs as they are from that version on. The seed creates rows only through RPCs that `rpc_contract.test.sql` pins, so it keeps working at the previous version. The checks live outside `supabase/tests/` on purpose, as the plain `supabase test db` would run them without a snapshot.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that drives the app over HTTP the way a browser and MO do. Run it after dependency upgrades and before opening a PR that touches a flow it covers:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<the server's token> \
  SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 \
  npm run smoke
```

| Variable                    | Required | Purpose                                                                                                        |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`                  | no       | Server under test; defaults to `http://localhost:4321`                                                         |
| `MO_INGEST_TOKEN`           | yes¹     | Must match the server's token                                                                                  |
| `SUPABASE_URL`              | yes¹     | The Supabase instance the server uses                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY` | yes¹     | Creates the smoke user and generates email-link tokens through the Admin API (there is no sign-up)             |
| `SUPABASE_KEY`              | no       | The anon key; checks that it can't execute `ingest_weekly_plan` directly. Without it: `SKIP  anon grant check` |
| `MAILPIT_URL`               | no       | Reads one real reset email from local Supabase's Mailpit. Without it: `SKIP  real reset email`                 |
| `KEEPALIVE_EXPECT_FAILURE`  | no       | `1` runs only the keep-alive check and expects it to fail (CI points a preview at an unreachable Supabase)     |

For a full run the server under test needs `SUPABASE_SERVICE_ROLE_KEY` and `MO_INGEST_TOKEN` configured too.

¹ Not needed with `KEEPALIVE_EXPECT_FAILURE=1`, which only fires the keep-alive: the script then needs only `BASE_URL`, and the server only `SUPABASE_URL` and `SUPABASE_KEY` (CI sets an unreachable `SUPABASE_URL`).

What it covers, each with its error and edge cases (unauthenticated calls, other users' data, invalid bodies):

- **Landing and sign-in:** `/` in both states, the sign-in page and its reset link, sign-in, protected pages, sign-out.
- **MO delivery:** token check, account creation for a new email, deliveries of the past, current, upcoming and a later week, identical and changed re-deliveries, 409 `week_started`.
- **Dashboard and history:** "No upcoming plan yet", the "This week" and "Next week" tabs, "Next week" staying on the nearest week, `/history` and `/history/<id>` (including 404s).
- **Swap and save:** swapping, `plan_locked`, a swap surviving re-deliveries, recency notes only from saved plans.
- **Ratings:** rating, clearing, `not_rateable`, "Last rated" on "Next week", and rating-ordered options (a 5/5 meal first and re-picked, a 1/5 meal last).
- **Email links:** invitation and reset links opened without using the token, short passwords, used, replaced and made-up tokens, the token-less retry after a refused password, an account created by a delivery claiming itself, and (with `MAILPIT_URL`) one real reset email.
- **Keep-alive:** fires the Cron Trigger (`/cdn-cgi/handler/scheduled`) and expects success.

Local Supabase sends at most 2 auth emails per hour (`email_sent` in `supabase/config.toml`), so running it with `MAILPIT_URL` more often than that fails the real-email step.

The smoke test guards the flows end to end; it is not a substitute for unit and database tests of new logic.

## Agent hooks

Claude Code runs two hooks from `.claude/settings.json` (scripts in `.claude/hooks/`, both need `jq`). Their output goes to the agent (exit 2 + stderr), so it fixes what they report before handing back.

- **After each `Write`/`Edit`** (`related-tests.sh`, 60 s): an edited file under `src/lib/` or `src/test/` runs `vitest related <file>` (a test file runs itself); UI code has no unit tests and is left to the end-of-turn sweep; an edited `supabase/tests/*.sql` runs that pgTAP file. With local Supabase down, the agent and the user get a notice instead.
- **At the end of each turn** (`end-of-turn.sh`, 180 s): every file changed against `HEAD` plus untracked ones, including files written through the shell. Changed code runs ESLint on those files and `npx astro check` side by side (~50 s), then the whole unit suite; a changed `supabase/` file runs `supabase test db`. New migrations are applied first with `npx supabase migration up --local` (it only adds, never resets); one that fails to apply is reported like a failing test. An edited migration that is already applied stays at its old version until `npx supabase db reset` (wipes local data), and the hook says so. With local Supabase down, pgTAP is skipped and the hook says so. A tree identical to the last green sweep is not checked again. The agent gets one retry; what is still red after that is left to the pre-commit hook and CI. A turn that changed code takes 60–90 s to finish; the spinner says so. A message typed meanwhile is answered first, and the hook's feedback arrives after it.

`scripts/__tests__/agent-hooks.test.ts` (part of `npm test`) runs both scripts in throwaway git repos with stubbed ESLint, astro, Vitest and Supabase CLI. Change it with the scripts. After editing the settings, restart the Claude Code session; `/hooks` lists what is loaded.

## CI

`.github/workflows/ci.yml` runs on every push and PR to `master`:

- **ci:** `npm run lint`, `npm test`, `npx astro check`, `npm run build` (with the `SUPABASE_URL` and `SUPABASE_KEY` repository secrets).
- **smoke:** starts local Supabase with the Supabase CLI (Mailpit included), runs `supabase test db`, builds, serves the production preview on the Cloudflare runtime with a fixed test `MO_INGEST_TOKEN`, and runs `npm run smoke` with every variable above set. It then rebuilds against an unreachable `SUPABASE_URL` and runs the smoke with `KEEPALIVE_EXPECT_FAILURE=1`, proving failed pings are reported. Last, as it resets the database, "Migration replay over seeded data" runs `npm run test:replay` (see [Migration replay](#migration-replay)). No secrets needed. A PR that only changes docs (root-level `*.md`, `docs/`, `context/`, `.claude/`) skips this job; the **changes** job decides (renames count both paths), pushes to `master` always run it, and so does a PR whose **changes** job fails.
- **deploy** (pushes to `master` only, after both jobs pass): `npx wrangler deploy`, then a post-deploy smoke against production. It checks that `/auth/signin` loads, `/dashboard` redirects, a wrong sign-in reaches Supabase (`error=invalid_credentials`, not `not_configured`), and a token-less `POST /api/mo/deliveries` answers 401. There, 503 means the Worker secrets are missing; 403 or a challenge page means Cloudflare bot protection is blocking MO.
