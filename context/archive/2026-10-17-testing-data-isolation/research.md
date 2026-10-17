---
date: 2026-10-17T12:33:12+02:00
researcher: Claude (Opus 5.5) for alan
git_commit: 97679b96e6b01962f01e7f8d4084e325cba9c1ac
branch: testing-data-isolation
repository: meal-orchestrator-web
topic: "S-03 data isolation sweep: what a second user can reach, what is already tested, what isn't"
tags: [research, testing, rls, security-definer, pgtap, smoke, isolation]
status: complete
last_updated: 2026-10-17
last_updated_by: Claude (Opus 5.5)
---

# Research: S-03 data isolation sweep

**Date**: 2026-10-17T12:33:12+02:00
**Researcher**: Claude (Opus 5.5) for alan
**Git Commit**: 97679b96e6b01962f01e7f8d4084e325cba9c1ac
**Branch**: testing-data-isolation
**Repository**: meal-orchestrator-web

## Research Question

From issue #121's open unknown and test-plan risk #3: which tables, functions and grants can be reached with the anon or authenticated key, and which functions run with the owner's rights (skipping RLS)? How does the app derive the user? What isolation coverage already exists, and where are the gaps a second-user test sweep must fill, so that "a new table, function or grant that leaks fails a test"?

## Summary

- **No leak found** in the inspected scope: the 12 migrations, the live local catalog at that migration level, every route under `src/pages/` and `src/middleware.ts`. So the sweep is tests only. **No migration is needed**, and this worktree does not need its own Supabase stack (CLAUDE.local.md).
- **Exposed surface (live local catalog, 2026-10-17).**
  - **Tables:** three, all in `public`: `weekly_plans`, `plan_meal_options`, `meal_ratings`. Each has RLS enabled, not forced, and exactly one policy: SELECT to `authenticated`, `user_id = (select auth.uid())`.
  - **Grants on those tables:** `anon` and `authenticated` each hold `SELECT, REFERENCES, TRIGGER`. INSERT, UPDATE, DELETE and TRUNCATE are revoked.
  - **Other objects:** no views, sequences, storage buckets or realtime publication tables. pg_graphql is not installed.
- **Functions that skip RLS (security definer), five in total:**
  - Callable by `authenticated`: `choose_plan_option`, `confirm_plan`, `rate_meal`. Each one checks `p.user_id = auth.uid()` before writing and raises `P0002 not_found` otherwise.
  - Callable only by `service_role`: `ingest_weekly_plan` (takes an email), `auth_link_is_valid`, `pick_default_choices` (takes a plan id with no ownership check, by design).
  - `anon` can execute only `keepalive`.
- **The real leak risk is future, not present.** Supabase's default privileges in `public` grant `anon` and `authenticated` all table privileges, and EXECUTE on every new function. A new table or function is exposed unless its migration revokes. A new security definer function granted to `authenticated` without an `auth.uid()` check would skip RLS. No current test fails on an object it doesn't list: `rpc_contract.test.sql` pins 8 named RPCs, and there is no catalog-wide allowlist.
- **App side.** The acting user comes only from the session (`auth.getUser()`). Identity reaches Postgres only as the JWT (`auth.uid()`). The service-role client is built in exactly 2 places, and neither is reachable with a user session in a way that returns another user's data. Three API routes take ids from the request that reach the DB: `optionId` and `planId` on choose, `planId` on confirm, `optionId` on ratings. `GET /history/[id]` takes a path id.
- **Coverage gaps.**
  - **pgTAP:**
    - No direct SELECT as user B on `weekly_plans` or `plan_meal_options`.
    - No real attempt at a direct INSERT, UPDATE or DELETE on those two tables (only `has_table_privilege` for UPDATE).
    - No check that `anon` reads nothing.
    - No denial of `authenticated` on `ingest_weekly_plan` or `auth_link_is_valid`.
    - No test that clearing a rating on another user's option is refused.
    - No invariant that a child row's `user_id` equals its plan's.
  - **Smoke:** nothing signs in a second user and sends user A's real ids to choose, confirm or ratings, or reads PostgREST `/rest/v1/*` with a user session.

## Detailed Findings

### Database surface (live catalog + migrations)

The live catalog was read from `supabase_db_mo-web` with all 12 migrations applied (`npx supabase migration list --local`). The queries are in the session scratchpad, not the repo.

**Tables** (`public`; RLS on, not forced; one SELECT policy each, to `authenticated`, `user_id = (select auth.uid())`):

| Table               | Defined                                 | Policy   | Write revokes | How `user_id` gets its value                                                                                     |
| ------------------- | --------------------------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `weekly_plans`      | `20261001120000_weekly_plans.sql:6-16`  | `:41-45` | `:53`         | FK to `auth.users` (`:8`)                                                                                        |
| `plan_meal_options` | `20261001120000_weekly_plans.sql:18-33` | `:47-51` | `:54`         | own column, **not** an FK and not tied to the plan's (`:21`)                                                     |
| `meal_ratings`      | `20261008120000_meal_ratings.sql:20-25` | `:29-33` | `:35`         | own column, not an FK; set from the plan owner in `rate_meal` (`20261010120000_warsaw_today_helper.sql:333-334`) |

- **anon:** no policy, so its leftover SELECT grant returns 0 rows.
- **INSERT, UPDATE, DELETE for both roles:** no policy and no grant, so they are denied twice over.
- **REFERENCES and TRIGGER grants:** they remain, but neither role has CREATE on any schema (live catalog), so they can't be used through PostgREST.

**Functions**: final definitions only. All have `search_path = ''`.

| Function                                      | Final definition                                    | Definer?     | EXECUTE (live)                                              | Scoping                                       |
| --------------------------------------------- | --------------------------------------------------- | ------------ | ----------------------------------------------------------- | --------------------------------------------- |
| `choose_plan_option(uuid)`                    | `20261010120000_warsaw_today_helper.sql:53-113`     | yes          | authenticated                                               | `p.user_id = auth.uid()` `:73`                |
| `confirm_plan(uuid)`                          | same file `:117-152`                                | yes          | authenticated                                               | `:131`                                        |
| `rate_meal(uuid, smallint)`                   | same file `:296-384`                                | yes          | authenticated                                               | `:319`; the re-pick is limited to `v_user_id` |
| `ingest_weekly_plan(…)`                       | same file `:156-292`                                | yes          | service_role only (`:289-292`)                              | takes `p_email`; safe only through the grant  |
| `pick_default_choices(uuid)`                  | `20261008180000_rating_ordered_defaults.sql:49-97`  | yes          | service_role only (`:97` revokes authenticated)             | no ownership check, by design                 |
| `auth_link_is_valid(text,text,int)`           | `20261005120000_auth_link_is_valid.sql:11-40`       | yes          | service_role only                                           | reads `auth.one_time_tokens`                  |
| `get_plan_recency(uuid)`                      | `20261007120000_recency_saved_plans_only.sql:16-42` | no (invoker) | authenticated                                               | RLS                                           |
| `get_plan_ratings(uuid)`                      | `20261008120000_meal_ratings.sql:95-122`            | no           | authenticated                                               | RLS                                           |
| `adjusted_score(smallint, smallint)`          | `20261008180000_rating_ordered_defaults.sql:27-42`  | no           | **authenticated** (only public and anon are revoked, `:42`) | pure arithmetic, no data                      |
| `keepalive()`                                 | `20260925192719_keepalive_function.sql:5-16`        | no           | anon, authenticated                                         | returns `now()`                               |
| `private.warsaw_date`, `private.warsaw_today` | `20261010120000_warsaw_today_helper.sql:28-49`      | no           | none; and no USAGE on `private` (`:25`)                     | —                                             |

The earlier `rate_meal` / `choose_plan_option` / `confirm_plan` / `ingest_weekly_plan` bodies in `20261003120000`, `20261008120000` and `20261008180000` are superseded by `20261010120000`. The ownership predicate is the same in each.

**Default privileges (live `pg_default_acl`).** For objects created by `postgres` or `supabase_admin` in `public`:

- tables: `arwdDxtm` to anon and authenticated
- functions: `X` (EXECUTE) to anon and authenticated
- sequences: `rwU` to anon and authenticated

No migration runs `alter default privileges`. This is why each existing migration ends with explicit revokes, and why a forgotten revoke would leak.

**Other API surfaces (local).**

- `supabase/config.toml:13` exposes `public` and `graphql_public`, but the `pg_graphql` extension isn't installed (`pg_extension`).
- The `supabase_realtime` publication has 0 tables.
- `storage.buckets` has 0 rows.
- No role holds CREATE on any schema.
- A `replay_snapshot` schema exists locally, left over from `npm run test:replay`. It has no anon or authenticated usage and doesn't exist on prod.

### App routes and user derivation

- **Clients** (`src/lib/supabase.ts`):
  - `createClient` (`:12`): anon key plus cookie session.
  - `createServiceClient` (`:38`): service role, bypasses RLS.
  - `createStatelessClient` (`:53`): anon key.
- **Middleware** (`src/middleware.ts:12-46`):
  - Sets `locals.user` through `readSessionUser`, which calls `auth.getUser()` (`src/lib/services/auth-session.ts:26`).
  - Skips the session for `/api/mo/` (`:17-21`).
  - `PROTECTED_ROUTES = ["/dashboard", "/history"]` (`:7`). No `/api/*` route is in it.
- **JSON API routes** (`/api/plans/*`, `/api/ratings`) go through `readJsonRequest` (`src/lib/json-request.ts:25-65`). It returns 401 without `locals.user` (`:36`), then runs zod. It never sends `user.id` to the DB; identity is only `auth.uid()` from the JWT.
- **Service-role use, 2 sites:**
  - `src/pages/api/mo/deliveries.ts:57`: bearer `MO_INGEST_TOKEN` with a constant-time compare (`:65-68`); cookies are ignored there.
  - `src/pages/auth/set-password.astro:40`: calls `auth_link_is_valid` and gets back a boolean about a token hash, not user data.

**Request ids that reach the DB.** These are the second-user attack inputs.

| Route                     | Input                                       | Call                                                               | Expected for A's id, as B                                                                |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `POST /api/plans/choose`  | `optionId`                                  | `choose_plan_option` (`src/lib/services/plans.ts:215`)             | 404 `not_found` (docs/api.md:88); A's `is_chosen` and `saved_at` unchanged               |
| `POST /api/plans/choose`  | `planId` (independent of the option)        | `get_plan_recency` re-read (`src/lib/plan-save.ts:50`)             | B's own save succeeds; the recency for A's plan comes back empty, with none of A's dates |
| `POST /api/plans/confirm` | `planId`                                    | `confirm_plan` (`services/plans.ts:224`)                           | 404; A's `saved_at` unchanged. **The smoke never calls this route.**                     |
| `POST /api/ratings`       | `optionId`, `rating` (incl. `null` = clear) | `rate_meal` (`src/lib/services/ratings.ts:43`)                     | 404 (docs/api.md:118); A's rating neither created nor deleted; no re-pick of A's weeks   |
| `GET /history/[id]`       | path uuid                                   | `weekly_plans … .eq(id).eq(user_id)` (`services/plans.ts:105-126`) | 404 (the smoke already checks this)                                                      |

On the read paths (dashboard, history), the `.eq(user_id, user.id)` filters duplicate RLS (`services/plans.ts:20-98`). An HTTP test through the app therefore can't show that RLS holds on its own. Direct PostgREST calls with B's JWT, or pgTAP, can.

### Existing coverage

**pgTAP.** Users are created by inserting fixed UUIDs into `auth.users`, one set per file. A test switches user with `set local role authenticated` plus `request.jwt.claims` (`docs/testing.md:14`). Existing cross-user assertions:

- `get_plan_recency.test.sql:117-122`: B on A's plan returns nothing.
- `meal_ratings.test.sql`:
  - `:102-117`: no write privileges, and a direct insert raises 42501.
  - `:152-156`: `rate_meal` on another user's option raises P0002.
  - `:208-224`: a direct SELECT returns only the caller's own rows.
  - `:300-305`: `get_plan_ratings` on C's plan returns nothing.
- `plan_choices.test.sql`:
  - `:68-75`: UPDATE privilege check only.
  - `:159-168`: choose and confirm on B's plan raise P0002.
  - `:182-191`: B's rows are unchanged.
- `rating_ordered_defaults.test.sql:185-189` and `:334-367`: another user's ratings and weeks are left untouched.
- `week_resubmission.test.sql:160, 202, 252, 322`: B's week is untouched by A's re-send.

**`rpc_contract.test.sql`.** `plan(40)` at `:10`; the `pg_temp.can` helper is at `:13-38`. It pins 8 RPCs with their args, result and per-role EXECUTE (`:42-93`):

- anon denied on 7 of them
- authenticated allowed on 5
- service_role allowed on `ingest_weekly_plan` and `auth_link_is_valid`

It doesn't assert that `authenticated` is denied on those two. It doesn't cover `pick_default_choices`, `adjusted_score` or `private.*`. Like every other test, it pins a named list. **No test enumerates `pg_proc` or `pg_class` to fail on an unlisted object.** `warsaw_today.test.sql:52-60` already walks `pg_proc` for another rule (excluding extension-owned functions through `pg_depend`), which is a pattern to reuse.

**Smoke** (`scripts/smoke.mjs`; S-02 Phase 3 is changing this file, so don't edit it):

- one signed-in user (`:437-446`, `:690`)
- a second user that exists only through MO deliveries and never signs in (`:256`, `:375`, `:739`, `:951`)
- cross-user checks:
  - `/history` doesn't list the other user's week (`:958-972`)
  - `/history/<other>` returns 404 (`:991-995`)
  - anon calling the `ingest_weekly_plan` RPC gets 401 with 42501 (`:719-736`)
- choose and rate are tested only without a session (401) or with a random option (404)

**e2e:** no isolation checks, by design (`context/foundation/test-plan.md:142`, `docs/testing.md:98`).

## Code References

- `supabase/migrations/20261001120000_weekly_plans.sql:38-54`: RLS, policies, write revokes for plans and options
- `supabase/migrations/20261008120000_meal_ratings.sql:27-35, 95-122`: ratings RLS and `get_plan_ratings`
- `supabase/migrations/20261010120000_warsaw_today_helper.sql:53-384`: final definer RPCs and their grants
- `supabase/migrations/20261008180000_rating_ordered_defaults.sql:27-97`: `adjusted_score`, `pick_default_choices`
- `src/lib/supabase.ts:12,38,53`: the three clients
- `src/middleware.ts:7,12-46`: user resolution and protected routes
- `src/lib/json-request.ts:25-65`: 401 gate and zod for the JSON routes
- `src/lib/services/plans.ts:20-126,143,215,224`, `src/lib/services/ratings.ts:43`, `src/lib/plan-save.ts:50`: DB calls per route
- `supabase/tests/rpc_contract.test.sql:10-142`: the pinned RPC and grant contract
- `supabase/tests/warsaw_today.test.sql:52-60`: an existing catalog walk over `pg_proc`

## Architecture Insights

- **Isolation layers.** Isolation has three layers:
  1. RLS (select only) on every table.
  2. No write grants: all writes go through security definer RPCs that check `auth.uid()`.
  3. Execute grants that keep the id- or email-taking definers away from `authenticated`.
- **Defence in depth.** App reads add `.eq(user_id)` on top of RLS.
- **Where a regression would come from.** It would come from a migration, not from app code:
  - a missing revoke (Supabase's defaults grant everything in `public`)
  - a new definer function without the ownership predicate
  - a new write path that sets a child row's `user_id` differently from its plan's (RLS on `plan_meal_options` and `meal_ratings` checks the row's own column)
- **What protects against it.** The cheapest protection is a pgTAP catalog allowlist:
  - every relation in the exposed schemas has RLS and only the known policies and grants
  - every function executable by `anon` or `authenticated` is on a known list, with its definer flag
  - a new object fails until someone adds it deliberately

  Behavioural second-user tests then cover each object on the list.

## Historical Context (from prior changes)

- `context/archive/2026-09-30-mo-weekly-delivery/plan.md:45`: "RLS isolation tests with two users" were out of scope then; isolation rested on the policies plus a manual check. `reviews/impl-review-phase-3.md:108`: "Isolation rests entirely on RLS." These are still accurate for the read side. Writes now also rest on the definer checks.
- `context/archive/2026-10-03-swap-and-save-plan/plan.md:160` and `reviews/impl-review-phase-2.md:31`: the choose route's `planId` is used only for the RLS-bound recency re-read and is never checked against the option. This still holds at `src/lib/plan-save.ts:50`, and nothing tests it with another user's plan.
- `context/archive/2026-10-07-plan-history-list/plan-brief.md:43`: RLS plus a `user_id` filter as defence in depth. `reviews/impl-review.md:36-44` (F2) added the smoke 404 for another user's past plan, which is still present at `scripts/smoke.mjs:991-995`.
- `context/archive/2026-10-08-rating-ordered-options/plan.md:95,127`: `rate_meal` bypasses RLS, so its re-pick is filtered by `user_id`. This still holds in the final body (`20261010120000_warsaw_today_helper.sql:347`).
- `context/archive/2026-10-05-expired-link-notice/plan.md:14`: the pattern of a definer function granted only to service_role, with execute revoked from public, anon and authenticated. It is followed by `auth_link_is_valid`.
- PRD US-03 (`context/foundation/prd.md:82`): a user sees only their own plans, history and ratings.

## Related Research

- `context/archive/2026-10-05-expired-link-notice/research.md`: the definer and grant pattern for service-role-only functions.

## Open Questions

1. **Hosted vs local surface.** On hosted Supabase projects, pg_graphql is typically enabled, and dashboard grants may differ. This research inspected only the local stack. Before relying on "GraphQL is not a surface", someone with dashboard access should check `pg_extension` and the realtime publication on prod, or add the check to the plan as a manual deploy step. This doesn't block the tests: a catalog-allowlist test run in CI checks the local schema, and RLS also applies to pg_graphql.
2. **Where the second-user HTTP check lives.** CLAUDE.local.md says to keep it out of `scripts/smoke.mjs` while S-02 changes that file. It could be a separate script, or a Playwright API test against the preview. This is a planning choice, as is whether it also calls PostgREST `/rest/v1/*` with B's JWT (the database API path risk #3 names).
3. **Whether to tighten `adjusted_score`.** Revoking `authenticated` would need a migration, which means a separate stack or waiting for S-02. It's harmless as it stands, so the recommendation is to pin it in the allowlist as allowed, not change it.
