# Migration and Date-Rule Safety Implementation Plan

## Overview

This is test-plan §3 Phase 1 (risks #1 and #5). It gives the SQL date rules one "today" that tests can pin, so a regression to UTC fails on every run. It also adds:

- date-boundary tests for the cut-off, the rating window, `week_started` and week selection;
- a pgTAP contract test that guards the previous Worker during the deploy window;
- a migration replay over seeded rows, run in CI for every new migration.

The oracle comes from the PRD and `docs/api.md` (see `research.md` "Oracle"), never from the SQL or TS under test.

## Current State Analysis

- **SQL "today" is inline everywhere.** The live functions write it as `(now() at time zone 'Europe/Warsaw')::date`: `choose_plan_option` and `confirm_plan` (`20261003120000_plan_choices.sql:137,195`), `ingest_weekly_plan` (`20261008180000_rating_ordered_defaults.sql:177`), and `rate_meal` (`:275`, which also gates the re-pick at `:317,335`). All four are `security definer` with `set search_path = ''`, so no test can shadow `now()`.
- **pgTAP fixtures depend on the real date.** They are relative to the real Warsaw today (`pg_temp.d(n)`), built with the same expression the functions use. A function that switched to `current_date` would fail only when CI runs between 22:00 and 24:00 UTC.
- **Boundary gaps.** Nothing tests the cut-off or `week_started` for a week that started yesterday (T-1). Week selection (`src/lib/services/plans.ts:20-120`) has only an argument-pinning test (`src/lib/services/plans.test.ts:41-63`).
- **No migration replay.** CI runs `supabase start` and then `supabase test db` on an empty database (`.github/workflows/ci.yml:53-56`).
- **Nothing pins the deploy-window contract.** "A migration must keep the old code working" (`docs/deployment.md:11-18`) holds today because no migration changes a signature, but no test enforces it.

## Desired End State

- A new migration adds the `private` schema with `private.warsaw_date(timestamptz)` and `private.warsaw_today()`. The four functions call the helper and behave exactly as before.
- A pgTAP guard fails if any other live function derives a date itself.
- `supabase/tests/date_boundaries.test.sql` pins today to a fixed past date and covers:
  - cut-off at T+1, T and T-1;
  - rating window at T+1, T, T-7 and T-8;
  - `week_started` at T+1, T and T-1, plus the first delivery of a started week;
  - the late-rating re-pick skipping started weeks.
- `supabase/tests/rpc_contract.test.sql` pins every RPC the TS calls (argument names and types, return type, execute grants) and the columns the TS reads.
- Vitest proves Next week, This week and history selection against rows, using a shared in-memory fake of the PostgREST query builder.
- `scripts/migration-replay.sh` resets to the previous migration, seeds rows through the RPCs, snapshots them, applies the newest migration, then runs the replay checks and the full pgTAP suite. CI's smoke job runs it.
- `docs/testing.md` and test-plan §6.1/§6.5 describe how to add a test for the next rule or migration.

Verify with `npm test`, `npx supabase test db`, the replay script, and a green CI run on the PR.

### Key Discoveries:

- `supabase test db [path...]` accepts paths (CLI 2.120.0), so replay checks can live outside `supabase/tests/` and run only from the replay script.
- There is no `private` schema yet (`grep "create schema" supabase/migrations` is empty). All four date-checking functions are `security definer`, so the helper needs no grant to `authenticated` or `service_role`. Postgres grants EXECUTE on new functions to PUBLIC by default, so the helpers must revoke it.
- `now()` also feeds timestamps (`received_at`, `saved_at`, rating `created_at`). The guard must forbid date derivation (`at time zone`, `current_date`, `::date` on now), not `now()` itself.
- `20261009090000_repick_unsaved_upcoming_plans.sql` is a `do` block, not a function. It stays as shipped and is outside the guard.
- The fixture weeks in pgTAP don't start on Mondays. `weekly_plans` has no Monday CHECK (`20261001120000_weekly_plans.sql:6-16`), so the boundary tests may use any day offset.
- `getPastPlans` awaits the builder directly, with no `maybeSingle` (`src/lib/services/plans.ts:84-90`), so the fake must be thenable as well as support `maybeSingle`.

## What We're NOT Doing

- Converting the existing relative-date pgTAP files to a pinned today, or removing the duplicated `pg_temp.d` helpers.
- A retroactive replay of `20261003120000` or `20261009090000` over old-schema data (production is past both).
- Running the previous `master` Worker's smoke against the new schema.
- Moving week selection into SQL or changing any read path.
- A per-user time zone (accepted in `swap-and-save-plan`), or pinning tzdata.
- Testing the 409 HTTP mappings beyond the existing smoke.
- GitHub issue and sub-issue bookkeeping. This change traces to test-plan §3, not to a roadmap item, so there is no parent issue.
- Hooks, e2e and CI pipelines beyond one added step (later test-plan phases or lessons).

## Implementation Approach

The contract test lands first in Phase 1, because the same phase rewrites four live functions and the contract test is what proves the rewrite kept every signature and grant. The helper migration follows, with its own timestamp tests and the bypass guard.

Phase 2 builds the boundary tests on the helper. On the SQL side, a pinned date far from the real one makes any check that bypasses the helper fail on every run. On the TS side, fixed `today` strings drive a row-filtering fake.

Phase 3 adds the replay harness. Its first real run replays this branch's own helper migration over seeded rows. Phase 3 also documents the patterns.

## Critical Implementation Details

- **Pinning today in a test.** A test file pins today by running `create or replace function private.warsaw_today()` inside its `begin … rollback`, so the change never outlives the file. It must run as `postgres`, the helper's owner, before any `set local role` or after `reset role`. Locally `postgres` is not a superuser, so `create or replace` fails with "must be owner" under `authenticated`. Replacing the function invalidates the cached plans that depend on it, so a re-pin would work too. For readability, use one pinned today per file and pin it at the top. The first assertion in `date_boundaries.test.sql` should prove the pin took effect, using a case the real date would answer differently: `rate_meal` on a meal dated 2026-03-30, the pinned T, is accepted. Under the real date that meal is months outside the window.
- **Order inside the migration.** The migration must create the helper before it redefines the four functions. Each redefinition copies the latest definition verbatim and changes only the date expression (`v_today` in `rate_meal`). Keep the `revoke`/`grant` statements as the repository re-states them.
- **The fake must fail loudly.** The fake builder implements only the methods the services use. Any other method must throw, so a future filter can't be silently ignored and pass a lying test.

## Phase 1: RPC contract and Warsaw "today" helper

### Overview

Pin the previous Worker's contract, then move every SQL date check behind one helper without changing behaviour.

### Changes Required:

#### 1. RPC and column contract test

**File**: `supabase/tests/rpc_contract.test.sql`

**Intent**: Prove that the old Worker's calls still resolve after a migration. The oracle is the consumer: the TS call sites (`src/lib/keepalive.ts:15`, `src/lib/services/plans.ts:143,190`, `src/lib/services/ratings.ts:43,74`, `src/lib/services/auth-links.ts:24`, `src/pages/api/mo/deliveries.ts:105`) and the row shapes in `src/types.ts` and `PLAN_SELECT`. The migrations are not the oracle.

**Contract**:
- For each RPC (`keepalive`, `get_plan_recency`, `choose_plan_option`, `confirm_plan`, `rate_meal`, `get_plan_ratings`, `auth_link_is_valid`, `ingest_weekly_plan`), assert:
  - the identity arguments with their names (PostgREST calls by name, e.g. `p_option_id uuid`);
  - the return type;
  - EXECUTE for the role whose client makes the call (authenticated, service_role or anon, read from the call site);
  - no EXECUTE for anon where the client isn't anon. The smoke already checks this for `ingest_weekly_plan`.
- Assert the columns that `PLAN_SELECT`, `getPastPlans` and `src/types.ts` read on `weekly_plans`, `plan_meal_options` and `meal_ratings`, plus the foreign key the `meal_ratings(rating)` embed relies on.

#### 2. Warsaw "today" helper migration

**File**: `supabase/migrations/20261010120000_warsaw_today_helper.sql`

**Intent**: Put the single SQL "today" in one place that tests can pin, and route the four live date checks through it. Behaviour, signatures and grants stay unchanged, so the old Worker is unaffected during the deploy window.

**Contract**:
- `create schema private`, with no usage for `anon` or `authenticated`. It is not in PostgREST's exposed schemas.
- `private.warsaw_date(p_at timestamptz) returns date`: stable, `set search_path = ''`, computes `(p_at at time zone 'Europe/Warsaw')::date`.
- `private.warsaw_today() returns date`: stable, returns `private.warsaw_date(now())`.
- Both helpers revoke EXECUTE from `public`, `anon` and `authenticated`.
- `create or replace` with identical signatures for `choose_plan_option(uuid)`, `confirm_plan(uuid)`, `ingest_weekly_plan(text, text, date, date, text, jsonb, jsonb)` and `rate_meal(uuid, smallint)`, each calling `private.warsaw_today()` in place of the inline expression.
- A header comment in the repository's migration style explains why the helper exists and that tests pin it.

#### 3. Helper and bypass-guard tests

**File**: `supabase/tests/warsaw_today.test.sql`

**Intent**: Prove that the helper maps instants to the Warsaw calendar date at the boundaries `docs/api.md` implies, and that no live function derives a date without it.

**Contract**:
- `private.warsaw_date` at:
  - `2026-10-18 21:59:59Z` → 2026-10-18, and `22:00:00Z` → 2026-10-19 (CEST midnight);
  - `2026-10-25 22:59:59Z` → 2026-10-25, and `23:00:00Z` → 2026-10-26 (CET, after the 2026-10-25 switch);
  - `22:30Z` on a Sunday in CEST → the Monday.
- `private.warsaw_today()` equals `private.warsaw_date(now())`.
- Privileges: `schema_privs_are` gives `anon` and `authenticated` no USAGE on `private`. `function_privs_are` gives `public`, `anon` and `authenticated` no EXECUTE on either helper. Postgres grants EXECUTE to PUBLIC by default, so this pins the revoke.
- Guard: no function in schemas `public` or `private` other than `private.warsaw_date` has a `prosrc` matching, case-insensitively (`~*`), `at time zone|timezone\s*\(|current_date|localtime(stamp)?|(now\(\)|current_timestamp)\s*::\s*date`. Plain `now()` stays allowed: keepalive, auth_link_is_valid and the `saved_at`/`received_at` assignments use it for timestamps.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all migrations cleanly, including the new one
- `npx supabase test db` passes, with the full output saved to a log (lessons.md), including `rpc_contract`, `warsaw_today` and all existing files unchanged
- `npm run lint` and `npm test` pass
- `warsaw_today.test.sql` asserts that `anon` and `authenticated` have no USAGE on `private` and no EXECUTE on either helper

#### Manual Verification:

- The diff of each redefined function against its latest previous definition changes only the date expression
- Mutation check: rename one RPC argument in a local scratch copy. `rpc_contract.test.sql` fails. Revert.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Date-boundary tests (pinned SQL today, TS week selection)

### Overview

Assert every date rule at its boundary days, with the expected values taken from the PRD and `docs/api.md`. SQL tests pin today. TS tests pass a fixed `today` and filter real rows.

### Changes Required:

#### 1. Pinned-today SQL boundary tests

**File**: `supabase/tests/date_boundaries.test.sql`

**Intent**: Cover test-plan §2 #5 for the write rules with a today that never matches the real one, so a function that bypasses the helper fails on every run. The oracle rows are:
- cut-off: PRD US-01 AC4 and `docs/api.md` "Cut-off";
- rating window: PRD US-08, FR-013 and `docs/api.md` Ratings;
- `week_started`: PRD US-07, FR-017 and FR-018.

**Contract**:
- Pin today to **2026-03-30**. Fixtures are absolute dates relative to it. Name the rating-window length once (PRD calls 7 "a best-guess value, to be tuned") instead of repeating the literal.
- Cut-off, for `choose_plan_option` and `confirm_plan`, as the owning user:
  - a plan starting T+1 is accepted;
  - a plan starting T or T-1 is refused with `55000`/`plan_locked`, and its choices and `saved_at` are unchanged.
- Rating window, for `rate_meal`:
  - meals dated T and T-7 are accepted;
  - meals dated T+1 and T-8 are refused with `not_rateable` and leave no row.
- `week_started`, for `ingest_weekly_plan` as service_role:
  - a changed re-send of a week starting T+1 replaces it;
  - a changed re-send of a week starting T or T-1 is refused with `week_started` and leaves the stored week unchanged;
  - a first delivery of a week starting T-1 is stored.
- Late-rating re-pick: rating a meal re-picks an unsaved plan starting T+1 and leaves an unsaved plan starting T untouched.
- Fixture conventions follow the existing files: `begin; select plan(N); … finish(); rollback;`, fixed UUIDs distinct from the other files, and `request.jwt.claims` impersonation.

#### 2. Shared in-memory PostgREST fake

**File**: `src/test/fake-supabase.ts`

**Intent**: A test-only stand-in for `SupabaseClient.from(table)` that applies the services' filters to an array of rows. Week-selection tests can then assert on behaviour instead of on query arguments. Later test-plan phases may reuse it.

**Contract**:
- `fakeSupabase(tables: Record<string, Row[]>)` returns an object usable as `SupabaseClient`.
- The builder supports `select` (returns rows as given; embeds come from the fixture), `eq`, `gt`, `lte`, `order(column, { ascending })`, `limit`, `maybeSingle` (object or `null`; an error result when there is more than one row, as PostgREST does), and `then`, so `getPastPlans` can await it.
- Comparisons use ISO date strings.
- Any other method throws `Error("fake-supabase: <method> not implemented")`.

#### 3. Week-selection behaviour tests

**File**: `src/lib/services/plans.test.ts`

**Intent**: Prove the `docs/api.md` "Weeks on the dashboard and in history" rules against rows. Replace the argument-only "selects the nearest future week, not the latest" test with behavioural cases. Keep the PGRST303 retry test.

**Contract** (rows are another user's plus the signed-in user's, so the `user_id` filter is exercised too):
- Today 2026-10-14 (Wednesday), with weeks 09-28, 10-05, 10-12, 10-19 and 10-26:
  - `getUpcomingPlan` returns 10-19 (the nearest, not 10-26);
  - `getCurrentPlan` returns 10-12;
  - `getPastPlans` returns `[10-05, 09-28]`, newest first;
  - `getPastPlan` returns `null` for the 10-12 and 10-19 ids and the plan for 10-05.
- Today 2026-10-19 (Monday), with weeks 10-12, 10-19 and 10-26:
  - `getCurrentPlan` returns 10-19 (T);
  - `getUpcomingPlan` returns 10-26;
  - 10-12 (T-7) is history only.
- Today 2026-10-19, with weeks 10-12 and 10-13:
  - `getCurrentPlan` returns 10-13 (T-6);
  - `getPastPlans` returns only 10-12.
- Only past weeks delivered: `getUpcomingPlan` returns `null`.
- Another user's nearer week is never returned.

### Success Criteria:

#### Automated Verification:

- `npx supabase test db` passes, with full output saved to a log, including `date_boundaries`
- `npm test` passes, including the new `plans.test.ts` cases
- `npm run lint` and `npx astro check` pass

#### Manual Verification:

- Mutation check (SQL): temporarily change `rate_meal`'s today to `current_date` on the local stack. `date_boundaries` fails at any time of day. Revert.
- Mutation check (TS): temporarily change `getUpcomingPlan`'s order to `ascending: false`, then `getCurrentPlan`'s `gt` bound to `gte`. A behavioural test fails each time. Revert.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Migration replay in CI, docs and cookbook

### Overview

Every new migration runs over realistic existing rows in CI, after which the PRD rules and the data invariants must still hold. This phase also documents the patterns this change established.

### Changes Required:

#### 0. CLI spike (first)

**Intent**: Before building on them, confirm two CLI behaviours the verification couldn't prove from the compiled binary:
- whether `npx supabase test db supabase/replay` runs a file from a directory outside `supabase/tests/`;
- whether `db reset --version` keeps CI's `-x` service exclusions.

Record the result in `change.md` Notes. If the outside directory isn't mounted, fall back to `pg_prove` through `docker exec` against the db container, or to running the checks file with psql plus `ON_ERROR_STOP` and pgTAP output.

**Contract**: The replay checks must never live under `supabase/tests/`. `pg_prove -r` is recursive, so the default `supabase test db` would run them against an empty snapshot. The replay deliberately runs the full suite a second time in the smoke job. That second run is the point: the rule tests over seeded rows.

#### 1. Replay seed

**File**: `supabase/replay/seed.sql`

**Intent**: Realistic rows, created only through RPCs whose signatures the contract test pins (`ingest_weekly_plan`, `choose_plan_option`, `confirm_plan`, `rate_meal`), so the seed stays valid at the previous migration version.

**Contract**:
- Two seed users with fixed UUIDs and emails distinct from every test file, inserted into `auth.users`.
- Per user:
  - weeks that are past (history), current, upcoming and later-upcoming, with dates relative to the real Warsaw today;
  - at least one saved upcoming plan with a swapped choice;
  - unsaved upcoming plans;
  - ratings inside the window, including one that triggers a re-pick.
- The seed ends by snapshotting into the `replay_snapshot` schema:
  - for saved plans and started weeks, the chosen option per slot as (`plan_id`, `meal_date`, `meal_type`, `provider_meal_id`);
  - all `meal_ratings`;
  - each plan's `saved_at`, `week_start` and `week_end`.

#### 2. Replay checks

**File**: `supabase/replay/checks.test.sql`

**Intent**: The PRD rules a migration must not break on existing data:
- choices of a saved plan or a started week aren't changed by the system (US-01, US-07);
- ratings are kept (US-08);
- each slot has exactly one chosen option (US-01).

**Contract** (pgTAP, run only by the replay script via `supabase test db supabase/replay`):
- The current chosen option per snapshotted slot equals the snapshot.
- Ratings equal the snapshot.
- `saved_at`, `week_start` and `week_end` are unchanged.
- Every slot in `plan_meal_options` has exactly one `is_chosen`.

#### 3. Replay script

**File**: `scripts/migration-replay.sh`

**Intent**: One command that checks the newest migration over seeded data. CI runs it. Locally it refuses to run without an explicit opt-in, because it wipes the local stack shared with `npm run dev` and other worktrees.

**Contract**:
- `scripts/migration-replay.sh [base-version]`. The default base is the second-newest file in `supabase/migrations/`.
- Exits with an explanation unless `CI=true` or `MIGRATION_REPLAY_WIPES_LOCAL_DB=1`.
- Steps:
  1. `npx supabase db reset --version <base> --local`;
  2. load `supabase/replay/seed.sql` with `psql` against `DB_URL` from `npx supabase status -o env`. If psql is not on PATH (it isn't in this WSL environment), fall back to `docker exec -i supabase_db_<project_id> psql -U postgres -v ON_ERROR_STOP=1`, with the project id from `supabase/config.toml`. CI's `supabase.env` doesn't keep `DB_URL`, so the script reads `status` itself;
  3. `npx supabase migration up --local`;
  4. `npx supabase test db supabase/replay`;
  5. `npx supabase test db`.
- Any failing step exits non-zero.
- Passing an older base replays every migration after it. That works only as far back as the seed's RPCs exist (`20261008180000`); document this limit.
- An npm script `test:replay` runs it.

#### 4. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the replay on every PR and master push in the `smoke` job, after the keep-alive failure-mode smoke and before `supabase stop`, so the reset can't disturb the smoke.

**Contract**: A new step, "Migration replay over seeded data", runs `npm run test:replay`. The job needs no new secrets.

#### 5. Docs and test plan

**Files**: `docs/testing.md`, `README.md`, `context/foundation/test-plan.md`

**Intent**: Describe the current state:
- the new test files;
- the replay command, what it wipes, the opt-in flag and its CI step;
- how to pin today in a pgTAP file.

Fill in the cookbook so the next rule or migration follows the pattern.

**Contract**:
- `docs/testing.md`:
  - a Replay row in the layer table;
  - a "Migration replay" section;
  - a note on pinning `private.warsaw_today()`;
  - the CI section names the new step;
  - the psql or `docker exec` requirement.
- `README.md`: a Scripts table row for `npm run test:replay`.
- `test-plan.md`:
  - §6.1 gets the patterns: pinned-today boundaries; a new date rule must call `private.warsaw_today()`, or the guard fails; contract test rows for a new RPC; the replay seed must use only contract-pinned RPCs; use the fake for read-side selection;
  - §6.5 gets a Phase 1 note;
  - §3 Phase 1 Status is advanced per the test-plan's status values.

### Success Criteria:

#### Automated Verification:

- `MIGRATION_REPLAY_WIPES_LOCAL_DB=1 npm run test:replay` passes locally, replaying `20261010120000_warsaw_today_helper.sql` over the seed, with output saved to a log
- `npm run test:replay` without the flag (and without `CI=true`) exits non-zero before touching the database
- The PR's CI run is green, including the "Migration replay over seeded data" step
- `npm run lint` passes and `npx prettier --check .` reports no changes

#### Manual Verification:

- Replay negative check: a scratch migration (not committed) that flips one saved plan's choice makes `checks.test.sql` fail. Delete the scratch file.
- `docs/testing.md` and test-plan §6.1 are enough for someone else to add a boundary test for a new date rule
- After CI is green and before merging, push `20261010120000_warsaw_today_helper.sql` to production as `docs/deployment.md` describes, and confirm the dashboard, a swap and a rating still work on the deployed (old) Worker

**Implementation Note**: After automated verification passes, pause for manual confirmation before opening the PR for merge.

---

## Testing Strategy

### Unit Tests:

- Week selection over rows at the T-7, T-6, T and T+1 edges, with two future weeks and another user's rows (`src/lib/services/plans.test.ts`, fake builder).
- Existing: `todayInWarsaw` and `addDays` across midnight and DST (`src/lib/plans.test.ts`), and `isRateable` (`src/lib/ratings.test.ts`).

### Integration Tests:

- pgTAP:
  - helper instants and the bypass guard;
  - pinned-today write-rule boundaries;
  - the RPC and column contract.
- Replay: seed at the previous version, apply the newest migration, run the snapshot checks and the full pgTAP suite.

### Manual Testing Steps:

1. Run the SQL and TS mutation checks from Phase 2 and confirm each one fails a test.
2. Run the replay negative check from Phase 3.
3. Run the post-push production check from Phase 3.

## Performance Considerations

The replay adds one `db reset`, a migration and two pgTAP runs to the `smoke` job, which should take about 1–2 minutes. There is no runtime impact: the helper is a stable SQL function called once per RPC.

## Migration Notes

`20261010120000_warsaw_today_helper.sql` keeps every signature, grant and behaviour, so the old Worker is unaffected between the push and the deploy. Push it after CI is green and before merging (`docs/deployment.md`). To roll it back, re-apply the previous definitions in a follow-up migration. Leaving the helper in place is harmless.

## References

- Tracking issue: #116 (one issue for the whole change, no phase sub-issues. Tick its Progress mirror and Open unknowns as rows land; the PR carries `Closes #116`)
- Research: `context/changes/testing-migration-date-rules/research.md`
- Test plan: `context/foundation/test-plan.md` §2 #1, #5 and §3 Phase 1
- Oracle sources: `context/foundation/prd.md` (US-01, US-05, US-07, US-08, FR-013, FR-017, FR-018, Business Logic) and `docs/api.md` (Cut-off, Ratings, Weeks on the dashboard and in history, MO delivery)
- Fixture pattern: `supabase/tests/week_resubmission.test.sql:1-40`
- Week-selection bug history: `context/archive/2026-10-08-next-week-nearest-upcoming/plan.md`
- Lessons: `context/foundation/lessons.md` (save the full pgTAP output on the shared stack)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: RPC contract and Warsaw "today" helper

#### Automated

- [x] 1.1 `npx supabase db reset` applies all migrations cleanly, including the new one — 8acb638
- [x] 1.2 `npx supabase test db` passes, with the full output saved to a log (lessons.md), including `rpc_contract`, `warsaw_today` and all existing files unchanged — 8acb638
- [x] 1.3 `npm run lint` and `npm test` pass — 8acb638
- [x] 1.4 `warsaw_today.test.sql` asserts that `anon` and `authenticated` have no USAGE on `private` and no EXECUTE on either helper — 8acb638

#### Manual

- [x] 1.5 The diff of each redefined function against its latest previous definition changes only the date expression — 8acb638
- [x] 1.6 Mutation check: rename one RPC argument in a local scratch copy. `rpc_contract.test.sql` fails. Revert. — 8acb638

### Phase 2: Date-boundary tests (pinned SQL today, TS week selection)

#### Automated

- [x] 2.1 `npx supabase test db` passes, with full output saved to a log, including `date_boundaries` — ac86053
- [x] 2.2 `npm test` passes, including the new `plans.test.ts` cases — ac86053
- [x] 2.3 `npm run lint` and `npx astro check` pass — ac86053

#### Manual

- [x] 2.4 Mutation check (SQL): temporarily change `rate_meal`'s today to `current_date` on the local stack. `date_boundaries` fails at any time of day. Revert. — ac86053
- [x] 2.5 Mutation check (TS): temporarily change `getUpcomingPlan`'s order to `ascending: false`, then `getCurrentPlan`'s `gt` bound to `gte`. A behavioural test fails each time. Revert. — ac86053

### Phase 3: Migration replay in CI, docs and cookbook

#### Automated

- [x] 3.1 `MIGRATION_REPLAY_WIPES_LOCAL_DB=1 npm run test:replay` passes locally, replaying `20261010120000_warsaw_today_helper.sql` over the seed, with output saved to a log — 7c70367
- [x] 3.2 `npm run test:replay` without the flag (and without `CI=true`) exits non-zero before touching the database — 7c70367
- [x] 3.3 The PR's CI run is green, including the "Migration replay over seeded data" step — 530b66b
- [x] 3.4 `npm run lint` passes and `npx prettier --check .` reports no changes — 7c70367

#### Manual

- [x] 3.5 Replay negative check: a scratch migration (not committed) that flips one saved plan's choice makes `checks.test.sql` fail. Delete the scratch file. — 530b66b
- [x] 3.6 `docs/testing.md` and test-plan §6.1 are enough for someone else to add a boundary test for a new date rule
- [x] 3.7 After CI is green and before merging, push `20261010120000_warsaw_today_helper.sql` to production as `docs/deployment.md` describes, and confirm the dashboard, a swap and a rating still work on the deployed (old) Worker
