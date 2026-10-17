# Data isolation sweep (test-plan Phase 3) Implementation Plan

## Overview

These tests prove that a second signed-in user can't read or change another user's plans, choices or ratings, and that a future table, function or grant that leaks fails a test. That is S-03 (#121), risk #3 of `context/foundation/test-plan.md`. The research found no current leak (`research.md`), so the change is tests and docs only, with no migrations.

## Current State Analysis

- **Exposed surface** (the live local catalog at all 12 migrations; `research.md` "Database surface"):
  - **Tables:** three in `public`. Each has RLS on and one SELECT policy, to `authenticated`, `user_id = (select auth.uid())`. `anon` and `authenticated` keep `SELECT, REFERENCES, TRIGGER`; their writes are revoked.
  - **Security definer functions callable by `authenticated`:** `choose_plan_option`, `confirm_plan`, `rate_meal`. Each checks `p.user_id = auth.uid()` (`supabase/migrations/20261010120000_warsaw_today_helper.sql:73,131,319`).
  - **Security definer functions callable only by `service_role`:** `ingest_weekly_plan`, `pick_default_choices`, `auth_link_is_valid`.
  - **What `anon` can execute:** only `keepalive`.
  - **Other surfaces:** pg_graphql isn't installed, the realtime publication has no tables, and there are no storage buckets.
- **Supabase's default privileges** grant anon and authenticated everything on new tables, functions and sequences in `public` (`pg_default_acl`). Every migration so far revokes by hand. No test fails on an object it doesn't name: `supabase/tests/rpc_contract.test.sql` pins 8 named RPCs.
- **Cross-user pgTAP coverage is partial, spread over 5 files** (`research.md` "Existing coverage"). Missing:
  - a direct SELECT by B on `weekly_plans` or `plan_meal_options`
  - real write attempts on those two tables
  - anon reads
  - denial of `authenticated` on the service-role functions
  - clearing another user's rating
  - the child-row `user_id` invariant
- **The smoke** (`scripts/smoke.mjs`) signs in one user. Its only cross-user checks are on `/history` (`:958-972`, `:991-995`). It never calls `/api/plans/confirm`, and never sends another user's real ids to choose or ratings. S-02 (#120) Phases 3–4 are still changing `scripts/smoke.mjs`, `docs/testing.md` and `context/foundation/test-plan.md`.

## Desired End State

- **`exposed_surface.test.sql`** fails on any difference from the reviewed snapshot of what the public keys can reach: a new relation, policy, grant or callable function, or a changed definer flag.
- **`second_user_isolation.test.sql`** shows that user B and anon get none of A's rows and change none of A's state on every table and function. It also shows that each option's and rating's `user_id` equals its plan's.
- **The smoke signs in a second user**, who sends A's real ids to every app route that takes an id and calls the database API directly with their own token. Every attempt is refused or returns nothing.
- **The test plan and docs:** test-plan §3 row 3 shows the phase complete, §6.3 tells the next contributor how to extend all three, and `docs/testing.md` lists the new files.
- **Verification:** `npx supabase test db` and `npm run smoke` pass locally and in CI.

### Key Discoveries:

- `supabase/tests/warsaw_today.test.sql:52-60` already walks `pg_proc` and skips extension-owned functions through `pg_depend` (`deptype = 'e'`). The allowlist needs the same skip, because pgTAP's own functions live in the test database.
- `supabase/tests/date_boundaries.test.sql:17-26` pins today by replacing `private.warsaw_today()` as `postgres` before any role switch (`docs/testing.md` "Pinning today"). The second-user file needs one future week (choose and confirm are allowed only before `week_start`) and one meal in the rating window, so it pins today.
- `supabase/config.toml:13` exposes `public` and `graphql_public`. These are the schemas the allowlist covers.
- `src/lib/plan-save.ts:50`: the choose route re-reads recency for the body's `planId`, which it never checks against the option (`context/archive/2026-10-03-swap-and-save-plan/reviews/impl-review-phase-2.md:31`). The HTTP pass sends B's own option together with A's plan id.
- The dashboard and history reads add `.eq(user_id)` on top of RLS (`src/lib/services/plans.ts:20-126`). Only the direct database-API calls show that RLS holds on its own.
- PostgREST answers a 42501 with 401 for anon and 403 for an authenticated JWT. The smoke's existing anon RPC check (`scripts/smoke.mjs:719-736`) asserts 401 plus code 42501, which is the pattern to follow.
- The post-deploy probe uses `curl` only (`.github/workflows/ci.yml:212-230`). The smoke never runs against prod, so a second password user is created only on the local and CI stacks.
- `context/foundation/lessons.md`: save the full pgTAP output to a log on the shared stack, and give each file its own user UUIDs and emails.

## What We're NOT Doing

- **No migrations.** That means no constraint tying a child row's `user_id` to its plan's (a pgTAP invariant covers it instead), and no revoke of `adjusted_score` from `authenticated`. That function is pure arithmetic, so the allowlist lists it as allowed.
- **No changes to `rpc_contract.test.sql`.** Its oracle is the deployed Worker's call sites. The allowlist's oracle is exposure. Both stay.
- **No removal or rewrite of the existing cross-user assertions** in `plan_choices`, `meal_ratings`, `get_plan_recency`, `rating_ordered_defaults` and `week_resubmission`.
- **No isolation checks in e2e** (test-plan §6.4).
- **No second-user checks against prod.** The post-deploy probe stays as it is.
- **No app route changes.** `docs/api.md` is unchanged.

## Implementation Approach

The work goes in layers, cheapest first, and only the HTTP layer waits on S-02:

1. **A pgTAP snapshot of the exposed surface (Phase 1).** It defines the closed set of objects a second user could ever reach.
2. **A pgTAP behavioural sweep over that set (Phase 2).** It acts as B and anon against A's data, with today pinned.
3. **The HTTP pass in the existing smoke (Phase 3).** It drives the same attacks through the app routes and through PostgREST with B's real token. This phase runs after S-02 merges.
4. **Docs (Phase 4).** Each of the four phases gets its own sub-issue. Phase 3's sub-issue is also Blocked by #120.

## Critical Implementation Details

- **Snapshot scope.** The allowlist lists objects in the exposed schemas (`public`, `graphql_public`) and skips extension-owned ones. It must not list `replay_snapshot`, which `npm run test:replay` leaves locally and which doesn't exist in CI before the replay step. The replay step runs the full suite after seeding, so the allowlist must also pass there; seeding adds rows, not objects.
- **Shared stack.** pgTAP and the smoke share the local Supabase with the main checkout and S-02. Use a UUID prefix and email domain no other test file uses, and save the full output to a log before any rerun (lessons.md).

## Phase 1: Exposed-surface allowlist

### Overview

A pgTAP file that pins the full set of what the anon and authenticated keys can reach. Any difference fails, so a migration that adds or loosens an object has to update this file deliberately.

### Changes Required:

#### 1. Allowlist test

**File**: `supabase/tests/exposed_surface.test.sql` (new)

**Intent**: Snapshot the exposed surface exactly. A new table, policy, grant or callable function, or a function that becomes security definer, then fails with a diff that names it. The header comment states the oracle: the reviewed surface in `research.md`, not the migrations. It also says what a migration author does when the test fails.

**Contract**:

- **Shape:** `begin; select plan(N); … finish(); rollback;`. It uses read-only catalog queries and no fixtures.
- **Assertions** (exact-set comparisons such as `results_eq` / `set_eq` over ordered rows, so the failure lists the extra or missing row):
  - **Relations:** every relation (`relkind` in r, p, v, m, f) in `public` and `graphql_public` equals the 3 known tables. Each has `relrowsecurity = true`.
  - **Sequences:** none in those schemas.
  - **Policies:** `pg_policies` rows for those schemas, as (table, policy name, command, roles, permissive, `qual`, `with_check`), equal the 3 known SELECT policies.
  - **Grants:** table privileges held by `anon` and `authenticated` (`information_schema.role_table_grants`), as (table, grantee, privilege), equal today's set: SELECT, REFERENCES and TRIGGER for each role on each table. There are also no column-level grants to either role.
  - **Callable functions:** functions in those schemas that `anon` or `authenticated` can execute (`has_function_privilege`), as (`oid::regprocedure`, role, `prosecdef`), with extension-owned functions skipped, equal today's set:
    - **anon:** `keepalive()` (invoker)
    - **authenticated, security definer:** `choose_plan_option(uuid)`, `confirm_plan(uuid)`, `rate_meal(uuid, smallint)`
    - **authenticated, invoker:** `keepalive()`, `get_plan_recency(uuid)`, `get_plan_ratings(uuid)`, `adjusted_score(smallint, smallint)`
  - **Schemas:** neither role has USAGE on `private` or CREATE on any schema.
- **Comments:**
  - Each expected set carries a one-line comment naming the migration that created the object.
  - The definer rows say that each one checks `auth.uid()`, and that a new definer row needs a matching case in `second_user_isolation.test.sql` (Phase 2).

### Success Criteria:

#### Automated Verification:

- Database tests pass with the new file: `npx supabase test db 2>&1 | tee <scratchpad>/pgtap.log`, with the log read on any failure
- The allowlist fails when the surface changes: in a scratch transaction (not committed), `grant insert on public.weekly_plans to authenticated` and a new `public` function each make `exposed_surface.test.sql` fail with a diff naming the object
- Lint and format pass: `npm run lint`, `npx prettier --check context/changes/testing-data-isolation`

#### Manual Verification:

- The prod surface matches local: someone with dashboard access runs, in the prod SQL editor, `select extname from pg_extension where extname = 'pg_graphql'` and `select * from pg_publication_tables`. The results are recorded as a comment on #121. If pg_graphql is enabled, the comment notes that it applies the same grants and RLS (so it is not a separate leak), and Phase 4 adds a line to `docs/deployment.md` Known risks

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Second-user sweep (pgTAP)

### Overview

One pgTAP file that acts as user B and as anon against user A's real data, on every table and every callable function from Phase 1's allowlist. It then checks that A's state is unchanged and that every child row's `user_id` matches its plan's.

### Changes Required:

#### 1. Second-user sweep

**File**: `supabase/tests/second_user_isolation.test.sql` (new)

**Intent**: This is the single isolation sweep the §6.3 cookbook points to: for each object on the allowlist, B (and anon) gets nothing back and changes nothing. Fixtures go through the real RPCs, so the `user_id` invariant is checked on the rows the app actually writes.

**Contract**:

- **Setup:**
  - Pin today the way `date_boundaries.test.sql` does: replace `private.warsaw_today()` as `postgres` before any role switch, with dates built from it.
  - Two users, A and B, with a UUID prefix and emails no other file uses.
  - Deliveries as `service_role` through `ingest_weekly_plan`:
    - For A, a week that has started, with a meal in the rating window, plus an upcoming week.
    - For B, an upcoming week, so B has rows of its own.
  - As A: `choose_plan_option`, `confirm_plan` and `rate_meal`, so A has chosen options, a saved plan and a rating.
  - Snapshot A's rows from all 3 tables (as the owner, after `reset role`) into a temp table.
- **As B** (`set local role authenticated` plus B's `request.jwt.claims`):
  - **Reads:** a direct SELECT on each of the 3 tables returns no row whose `user_id` is not B's. B's own rows are visible, which proves the read worked.
  - **Direct writes:** INSERT, UPDATE and DELETE on each of the 3 tables raise `42501`. The UPDATE and DELETE target A's row ids.
  - **Definer RPCs with A's ids**, each raising `P0002` / `not_found`:
    - `choose_plan_option(A's option)`
    - `confirm_plan(A's plan)`
    - `rate_meal(A's option, 4)`
    - `rate_meal(A's option, null)` (clearing)
  - **Invoker RPCs:** `get_plan_recency(A's plan)` and `get_plan_ratings(A's plan)` return empty.
  - **Service-role RPCs:** `ingest_weekly_plan`, `pick_default_choices` and `auth_link_is_valid` raise `42501`.
- **As anon:**
  - A SELECT on each of the 3 tables returns 0 rows.
  - Each non-keepalive RPC on the allowlist raises `42501`.
- **After `reset role`:**
  - A's rows equal the snapshot.
  - No `plan_meal_options` row has a `user_id` different from its plan's.
  - No `meal_ratings` row has a `user_id` different from its option's plan's.
- **Header comment:** the oracle is PRD US-03 and `docs/api.md` (`not_found` for "someone else's"). It also says that a new table or RPC on the allowlist adds its case here.

### Success Criteria:

#### Automated Verification:

- Database tests pass: `npx supabase test db 2>&1 | tee <scratchpad>/pgtap.log`, with the log read on any failure
- The sweep catches a leak: in a scratch, uncommitted run, a permissive `using (true)` SELECT policy on `plan_meal_options` makes the B-reads assertion fail, and the same file passes again after rollback
- Lint and format pass: `npm run lint`

#### Manual Verification:

- Each allowlist row from Phase 1 has at least one case in this file (or, for `keepalive` and `adjusted_score`, a comment saying why none is needed)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Second-user HTTP pass (smoke)

### Overview

Extend `scripts/smoke.mjs` (after S-02 merges) with a second signed-in user B. B sends the main smoke user's (A's) real ids to every app route that takes one, and calls PostgREST directly with B's own token.

### Changes Required:

#### 1. Second signed-in user and app-route attacks

**File**: `scripts/smoke.mjs`

**Intent**: Prove through the real Worker that the routes refuse another user's ids and show none of their data. This covers the confirm route, which no HTTP test calls today, and the choose route's unchecked `planId`. The code is placed after S-02's reshaped flow, following its structure.

**Contract**:

- **User B:** created through the Admin API with a password, the same way the main user is (`:437-446` before S-02), with its own cookie jar. B receives its own MO delivery and signs in through `/api/auth/signin`.
- **A's ids:** taken from A's delivered and saved state. Use whatever the smoke already reads after S-02; otherwise the service-role REST API.
- **Requests as B, with expected results:**
  - `POST /api/plans/choose` with A's `optionId`: 404 `not_found`.
  - `POST /api/plans/choose` with B's own option and A's `planId`: 200, and the returned recency contains none of A's dates.
  - `POST /api/plans/confirm` with A's `planId`: 404 `not_found`.
  - `POST /api/ratings` with A's `optionId`, both `rating: 4` and `rating: null`: 404 `not_found`.
  - `GET /history/<A's past plan id>`: 404.
  - `GET /dashboard`: the HTML contains none of A's meal names. A's delivery uses meal names that only A has.
- **Afterwards:** A's choices, `saved_at` and rating are unchanged. Check through A's session or the service-role REST API.

#### 2. Direct database-API pass with B's token

**File**: `scripts/smoke.mjs`

**Intent**: Exercise the path risk #3 names: the real anon key, PostgREST and the exposed schemas, with a user's own session. The pgTAP `set role` simulation can't cover this.

**Contract**:

- **Gate:** runs only when `SUPABASE_KEY` is set, like the existing anon RPC check. CI always sets it (`.github/workflows/ci.yml:104`).
- **B's token:** from `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` with the anon key. Requests send `apikey: <anon>` and `Authorization: Bearer <B's access token>`.
- **Tables:**
  - `GET /rest/v1/{weekly_plans,plan_meal_options,meal_ratings}?select=*` answers 200 with only B's rows.
  - POST, PATCH and DELETE on each table, filtered to A's ids, answer 403 with code `42501`.
- **RPCs:**
  - `POST /rest/v1/rpc/{choose_plan_option,confirm_plan,rate_meal}` with A's ids answer code `P0002`.
  - `POST /rest/v1/rpc/{get_plan_recency,get_plan_ratings}` with A's plan answer 200 and empty.
  - `POST /rest/v1/rpc/{ingest_weekly_plan,pick_default_choices,auth_link_is_valid}` answer 403 with code `42501`.
- **Failure messages** name the table or RPC and the status.

### Success Criteria:

#### Automated Verification:

- The smoke passes against a local preview: `ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4324` and `BASE_URL=http://localhost:4324 npm run smoke`, with `SUPABASE_KEY` set
- The CI `smoke` job passes on the PR
- Lint passes: `npm run lint`

#### Manual Verification:

- The smoke output lists each new second-user step by name, and a deliberately wrong expectation (temporarily expecting 200 for B's confirm of A's plan) makes the smoke fail with a message naming the route

**Implementation Note**: This phase starts only after S-02 (#120) has merged to `master` and this branch has merged `master`. After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Test-plan and docs upkeep

### Overview

Record what Phase 3 of the rollout delivered, and how to extend it, in the test plan and the testing docs, after S-02's own doc edits have landed.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Mark rollout Phase 3 complete and replace the §6.3 "TBD" with the second-user pattern, so the next table, RPC or route gets its isolation test.

**Contract**:

- **§3 row 3:** Status `complete`, change folder `testing-data-isolation`.
- **§5:** the database gate row's "scope widens" note now reflects Phases 1–3.
- **§6.3:** bullets covering:
  - **New table, function or grant:** update `exposed_surface.test.sql` in the same migration PR. A new security definer function granted to `authenticated` must check `auth.uid()`, and gets a case in `second_user_isolation.test.sql`.
  - **New write path for child rows:** the `user_id` invariant.
  - **New route taking an id:** a second-user step in the smoke, plus the matching direct `/rest/v1` call.
  - **Reference tests.**
- **§6.5:** a Phase 3 note on what was learned, e.g. "no leak found; the risk was default privileges".

#### 2. Testing docs

**File**: `docs/testing.md`

**Intent**: The docs describe the current test suite.

**Contract**:

- The pgTAP file list (after `rpc_contract.test.sql` / `warsaw_today.test.sql`) adds `exposed_surface.test.sql` and `second_user_isolation.test.sql`, one line each.
- The smoke section's coverage line names the second signed-in user and the direct database-API pass (needs `SUPABASE_KEY`).

#### 3. Deployment known risks (only if Phase 1's manual check found pg_graphql enabled on prod)

**File**: `docs/deployment.md`

**Intent**: Record that prod exposes GraphQL, which local and CI don't, so the allowlist doesn't cover it directly.

**Contract**: one bullet under "Known risks".

### Success Criteria:

#### Automated Verification:

- Format passes: `npx prettier --check context/foundation/test-plan.md docs/testing.md docs/deployment.md`
- Lint passes: `npm run lint`

#### Manual Verification:

- §6.3 reads as a complete recipe: following it for a hypothetical new table would update all three layers
- Issue #121's "Test-plan §3 row 3 and §6.3 cookbook updated" box is ticked

**Implementation Note**: This phase starts after S-02's Phase 4 has merged (with S-02's PR), so the doc edits don't conflict.

---

## Testing Strategy

### Unit Tests:

- None. No TypeScript logic changes.

### Integration Tests:

- pgTAP: `exposed_surface.test.sql` (structure) and `second_user_isolation.test.sql` (behaviour), in the CI `smoke` job's `supabase test db` and again in the migration replay.
- HTTP: the smoke's second-user and direct database-API steps, in the CI `smoke` job.

### Manual Testing Steps:

1. Break the surface in a scratch transaction (grant a write, add a permissive policy, add a function) and see both pgTAP files fail with a named diff.
2. Run the smoke locally on port 4324 and read the second-user steps in its output.
3. Run the prod catalog check (Phase 1 manual step) and record it on #121.

## Performance Considerations

The two pgTAP files are small: catalog reads plus a few deliveries. The smoke gains about 20 requests, which is negligible next to the current ~3-minute job.

## Migration Notes

Not applicable: no migrations. Migration authors from now on must update `exposed_surface.test.sql` whenever the exposed surface changes; Phase 4 documents this in §6.3.

## References

- Research: `context/changes/testing-data-isolation/research.md`
- Issue: #121 (S-03); S-02: #120 (Phase 3 blocked by its merge)
- Phase sub-issues: #185 (Phase 1), #186 (Phase 2), #187 (Phase 3, also blocked by #120), #188 (Phase 4)
- Patterns: `supabase/tests/warsaw_today.test.sql:52-60` (catalog walk), `supabase/tests/date_boundaries.test.sql:17-26` (pinned today), `supabase/tests/rpc_contract.test.sql:13-38` (privilege helpers), `scripts/smoke.mjs:719-736` (PostgREST 42501 check)
- Prior decisions: `context/archive/2026-09-30-mo-weekly-delivery/plan.md:45` (two-user RLS tests deferred), `context/archive/2026-10-03-swap-and-save-plan/reviews/impl-review-phase-2.md:31` (choose `planId` unchecked)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Exposed-surface allowlist

#### Automated

- [x] 1.1 Database tests pass with the new file — d651e0f
- [x] 1.2 The allowlist fails when the surface changes — d651e0f
- [x] 1.3 Lint and format pass — d651e0f

#### Manual

- [x] 1.4 The prod surface matches local — d651e0f

### Phase 2: Second-user sweep (pgTAP)

#### Automated

- [x] 2.1 Database tests pass — fb728bd
- [x] 2.2 The sweep catches a leak — fb728bd
- [x] 2.3 Lint and format pass — fb728bd

#### Manual

- [x] 2.4 Each allowlist row has a case in the sweep — fb728bd

### Phase 3: Second-user HTTP pass (smoke)

#### Automated

- [x] 3.1 The smoke passes against a local preview
- [ ] 3.2 The CI smoke job passes on the PR
- [x] 3.3 Lint passes

#### Manual

- [x] 3.4 The smoke output lists the second-user steps and fails on a wrong expectation

### Phase 4: Test-plan and docs upkeep

#### Automated

- [ ] 4.1 Format passes
- [ ] 4.2 Lint passes

#### Manual

- [ ] 4.3 §6.3 reads as a complete recipe
- [ ] 4.4 Issue #121's test-plan box is ticked
