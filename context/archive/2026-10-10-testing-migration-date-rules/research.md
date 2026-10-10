---
date: 2026-10-10T15:01:24+02:00
researcher: Claude (Opus 5.5) for alan
git_commit: 0d4288d2162f364d1db19ba440cd8072f66bcb03
branch: testing-migration-date-rules
repository: meal-orchestrator-web
topic: "Test-plan Phase 1: migration and date-rule safety (risks #1 and #5)"
tags: [research, testing, pgtap, migrations, date-rules, supabase]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude (Opus 5.5)
---

# Research: Test-plan Phase 1, migration and date-rule safety

**Date**: 2026-10-10T15:01:24+02:00
**Researcher**: Claude (Opus 5.5) for alan
**Git Commit**: 0d4288d (uncommitted: `CLAUDE.md`, `context/foundation/test-plan.md`)
**Branch**: testing-migration-date-rules
**Repository**: meal-orchestrator-web

## Research Question

`context/foundation/test-plan.md` §3 Phase 1 covers two risks:

- **#1:** a migration ships plan logic, a grant or a policy that behaves differently than intended, and it runs on the hosted database before the matching code merges.
- **#5:** date rules go wrong at their boundaries.

The questions for this phase:

- What should the tests prove (the oracle, taken from the sources)?
- Where does each rule live, and where does "today" come from?
- What do the existing tests already cover, and what is missing?
- Which mechanisms exist for a migration replay over seeded data and for controlling the clock?

## Summary

- **The oracle is settled and needs no product decision.** It comes from the PRD and `docs/api.md`, not the code:
  - Cut-off: a plan can be changed while `week_start > today`.
  - Rating window: `today-7 ≤ meal_date ≤ today`.
  - "Next week" is the nearest `week_start > today`. "This week" is `today-7 < week_start ≤ today`. History is `week_start ≤ today-7`.
  - A changed re-send of a started week answers 409 `week_started`.
  - Recency counts only saved plans.
  - "Today" is the Europe/Warsaw calendar date (`docs/api.md:3`; MO plans weeks in Warsaw, `context/archive/2026-09-30-mo-weekly-delivery/plan.md:16,102`).
- **"Today" is computed in one expression per side.**
  - SQL: `(now() at time zone 'Europe/Warsaw')::date`, in all 7 date checks across the migrations (list below). The migrations contain no `current_date`.
  - TS: one helper, `todayInWarsaw(now)` (`src/lib/plans.ts:24-28`). The pages call it with `new Date()`, and the services take the result as a `today: string` parameter.
- **Existing coverage.**
  - pgTAP hits the main day boundaries of the cut-off, the rating window and `week_started`, using dates relative to the real Warsaw today.
  - Missing:
    - the day after a plan starts (T-1);
    - any time-of-day or time-zone boundary in SQL;
    - any behavioural test of the "Next week", "This week" and history week selection (`src/lib/services/plans.test.ts:41-63` only pins the query arguments);
    - any migration replay over pre-existing rows.
- **The pgTAP date tests can't catch a time-zone regression on demand.** They build "today" with the same expression the functions use, and `now()` is the real transaction time. If a function switched to `current_date`/UTC, the tests would fail only when CI happens to run between 22:00 and 24:00 UTC (23:00–24:00 in winter). All 17 functions use `set search_path = ''`, so a test can't shadow `now()` either. Controlling the SQL clock needs a change to production SQL. That is a choice for `/10x-plan` (see Open Questions).
- **Migration compatibility.** No migration changes a function's signature or return type: there is no `drop function` or `alter function`, and each redefinition is a `create or replace` with the same arguments. So an old Worker's RPC calls keep resolving, and only the behaviour behind them changes. Two migrations act on existing rows:
  - `20261003120000_plan_choices.sql` (`is_chosen` backfill plus a partial unique index);
  - `20261009090000_repick_unsaved_upcoming_plans.sql` (re-picks the unsaved upcoming plans as of the push date).
- **The replay mechanism exists.** The local CLI (v2.120.0) has `supabase db reset --version <ts>` ("Reset up to the specified version") and `supabase migration up --local`, so a test can seed rows at version N and then apply N+1…latest. `config.toml:60-65` enables `./seed.sql`, but the file does not exist. CI starts from a fresh runner with `supabase start` and has no reset step (`.github/workflows/ci.yml:53-56`).

## Detailed Findings

### Oracle (expected behaviour, from sources)

| Rule | Source | Boundary cases the plan must cover (test-plan §2 #5) |
|---|---|---|
| Plan editable only before its first day | PRD US-01 AC4 (`prd.md:58`), FR-009/010 (`:170,172`), Business Logic (`:217`); `docs/api.md` "Cut-off": editable while `week_start` is after today, 409 `plan_locked` from Monday 00:00 Warsaw | Plan starting T+1 (allowed), T (refused), T-1 (refused) |
| Rating window: the meal's day or the 7 days after it | PRD US-08 (`prd.md:131-139`), FR-013 (`:181`); `docs/api.md` Ratings: "today minus 7 days to today, both included", 409 `not_rateable` | Meal dated T+1 (refused), T, T-7 (allowed), T-8 (refused) |
| "Next week" = nearest week with Monday after today; a later week stays hidden until the nearer one starts | PRD US-05 (`prd.md:103`, "does not present an older plan as the upcoming one"); `docs/api.md` "Weeks on the dashboard" | Two future weeks delivered; nearer one starting T+1 vs T |
| "This week" = Monday is today or up to 6 days earlier; history = `week_start ≤ today-7` | `docs/api.md` "Weeks on the dashboard and in history" | week_start T, T-6 (this week), T-7 (history), T+1 (next) |
| Changed re-send of a started week → 409 `week_started`; first delivery of a started week is stored; identical re-send changes nothing | PRD US-07 (`prd.md:118-127`), FR-017/018; `docs/api.md` "MO delivery" | Week starting T+1 (replaced), T, T-1 (409) |
| Recency only from saved plans, matched by (`provider`, `provider_meal_id`) | PRD FR-008 update 2026-10-06 (`prd.md:169`); `docs/api.md` "Recency notes" | Not date-relative (uses meal dates only) |
| "Today" is the Warsaw calendar date | `docs/api.md:3`; archive `mo-weekly-delivery/plan.md:16,102`; `swap-and-save-plan/plan.md:39` (no per-user zone, accepted) | 22:30Z Sunday = Monday 00:30 Warsaw (CEST); DST switch 2026-10-25 |

The PRD itself names no time zone. The Warsaw rule comes from `docs/api.md` and the archived decisions, and the planning sources agree on it. The PRD calls the 7-day window "a best-guess value, to be tuned" (`prd.md:217`), so a test should reference it as one named value, not scatter the literal 7.

### Where each rule is enforced and where "today" comes from

| Rule | Enforced in | "Today" |
|---|---|---|
| Cut-off | SQL only. `choose_plan_option` `20261003120000_plan_choices.sql:137`, `confirm_plan` `:195` (latest definitions; never redefined). TS maps 409 (`src/lib/plan-save.ts:39`) | `(now() at time zone 'Europe/Warsaw')::date` |
| Rating window | SQL `rate_meal` latest `20261008180000_rating_ordered_defaults.sql:275,292`; UI `isRateable` `src/lib/ratings.ts:36-38` (shows the faces) | SQL: same expression; TS: `today` param from `todayInWarsaw` |
| `week_started` | SQL `ingest_weekly_plan` latest `20261008180000_rating_ordered_defaults.sql:177`; mapped to 409 at `src/pages/api/mo/deliveries.ts:149-152` | same SQL expression |
| Late-rating re-pick of upcoming plans | SQL `rate_meal` `20261008180000…:317,335` (`week_start > v_today`) | same SQL expression |
| "Next week" / "This week" / history | TS services `src/lib/services/plans.ts:31-33` (`gt today`, asc, limit 1), `:59-60` (`lte today`, `gt today-7`), `:89`, `:118` (`lte today-7`) | `today: string` param; pages compute it inline: `src/pages/dashboard.astro:27`, `src/pages/history/index.astro:19`, `src/pages/history/[id].astro:17` |
| One-off re-pick data migration | `20261009090000_repick_unsaved_upcoming_plans.sql:11,21,32` | same SQL expression, evaluated at push time |

- **TS and SQL agree** on the zone and the predicates. The only divergence is timing: TS computes "today" once at page render, and SQL computes it at write time. A page rendered before Warsaw midnight and posted after it gets a 409, which the UI handles (`usePlanChoices.ts:54,63`, `useMealRating.ts:34,40`).
- **tzdata is not pinned.** Postgres and workerd/ICU each ship their own tzdata, and nothing pins them. This is an inference from the architecture, not a found defect.

### Existing coverage (what is already proven)

| File | Proves | Date boundaries hit | Missing for this phase |
|---|---|---|---|
| `supabase/tests/plan_choices.test.sql` | Cut-off for `choose_plan_option` and `confirm_plan` (81-156); a locked plan is unchanged (177-191); ownership | start T+1 allowed, T refused | start T-1 |
| `supabase/tests/week_resubmission.test.sql` | `week_started` for T (340-345) and T-7 (346-351); refused re-sends change nothing; first delivery of T-14 stored (377-390); identical no-op | T+1, T+8, T, T-7, T-14 | T-1 |
| `supabase/tests/meal_ratings.test.sql` | Window T, T-7 allowed; T+1, T-8 `not_rateable` (120-139) | all four | — |
| `supabase/tests/rating_ordered_defaults.test.sql` | Late-rating re-pick excludes started weeks (week T keeps its pick, 325-327) | T, T+8…T+43 | — |
| `supabase/tests/get_plan_recency.test.sql` | Recency from saved plans only (86-115) | fixed dates (no today) | — |
| `src/lib/plans.test.ts` | `todayInWarsaw` across midnight and both DST sides (17-42); `addDays` across month, year, leap day and DST (278-301); `formatEditableUntil` (326-335) | TZ boundaries in TS | — |
| `src/lib/ratings.test.ts` | `isRateable` T, T-7, T+1, T-8, month edge (29-53) | all four | — |
| `src/lib/services/plans.test.ts` | "Next week" query args only (41-63); mirrors the implementation with a stubbed builder | none | behavioural week selection (two future weeks, This week, history edges T, T-6, T-7, T+1) |

Notes on these tests:

- **"Today" is relative.** The pgTAP files use the real Warsaw today ("so the test never ages"), either inline or via a `pg_temp.d(n)` helper (`week_resubmission.test.sql:10-11`, `rating_ordered_defaults.test.sql:10-11`, duplicated in each). Vitest passes fixed dates and runs with `TZ=Pacific/Honolulu` (`vitest.config.ts:10-12`). No test calls `setSystemTime` for dates.
- **The fixture weeks don't start on Mondays** (T+1, T+8 and so on). `weekly_plans` has no Monday CHECK (`20261001120000_weekly_plans.sql:6-16`), and only `moDeliverySchema` requires a Monday (`src/lib/mo-delivery.ts:17-18`).
- **The 409 HTTP mappings** (`plan_locked`, `week_started`, `not_rateable`) are checked only by the smoke (`scripts/smoke.mjs:837,1036,1077`).
- **Fixture pattern:**
  - each file wraps everything in `begin; select plan(N); … finish(); rollback;`;
  - users are fixed UUIDs inserted into `auth.users`;
  - a test impersonates a user with `set local role authenticated` plus `set_config('request.jwt.claims', …, true)`, and sends deliveries as `set local role service_role`.

### Migrations: compatibility and existing-row effects

**Signatures.** Every redefinition keeps the arguments and return type and re-states the same grants. The RPCs that TS calls, with the arguments the old Worker depends on:

| Function | Called from | Arguments |
|---|---|---|
| `keepalive` | `src/lib/keepalive.ts:15` | none |
| `get_plan_recency` | `src/lib/services/plans.ts:143` | `p_plan_id` |
| `choose_plan_option` / `confirm_plan` | `src/lib/services/plans.ts:190` | `p_option_id` / `p_plan_id` |
| `rate_meal` | `src/lib/services/ratings.ts:43` | `p_option_id`, `p_rating` |
| `get_plan_ratings` | `src/lib/services/ratings.ts:74` | `p_plan_id` |
| `auth_link_is_valid` | `src/lib/services/auth-links.ts:24` | `p_token_hash`, `p_type`, `p_lifetime_seconds` |
| `ingest_weekly_plan` | `src/pages/api/mo/deliveries.ts:105` | 7 `p_*` arguments |

**What else the old Worker depends on:**

- Direct table reads through `PLAN_SELECT` (`src/lib/services/plans.ts:9`): `saved_at`, `plan_meal_options(*)` and the `meal_ratings(rating)` embed.
- Error codes and messages: `P0002 not_found`, `55000 plan_locked` (`plans.ts:175-176`), `P0002 unknown_user`, `week_started`, `not_rateable`.

**Statements acting on existing rows:**

- `20261003120000_plan_choices.sql:13-16` adds `is_chosen` and backfills `is_chosen = is_recommended`.
- `:18-20` adds a partial unique index for one chosen row per slot. It fails on existing data if any slot has two `is_recommended` rows.
- `:22-23` adds `saved_at` as null, so existing plans become "never saved".
- `:26-30` swaps an index.
- `20261009090000_repick_unsaved_upcoming_plans.sql:9-43` re-picks every unsaved plan with `week_start > today` and leaves saved plans and started weeks alone. Its result depends on the date it runs.

**Behaviour changes without a backfill.** These are accepted, documented deploy-window effects, not failures:

- `20261007120000_recency_saved_plans_only.sql:12-13,36`: recency notes from never-saved plans disappear at push time.
- `20261008180000_rating_ordered_defaults.sql:22,242`: the suggested pick replaces `is_recommended` as the default, so between the push and the deploy the old Worker shows re-picked selections (`context/archive/2026-10-08-rating-ordered-options/reviews/impl-review-phase-2.md:72-80`, F5 accepted).
- `20261006120000_week_resubmission_rules.sql`: until the deploy, the old Worker maps `week_started` to 500, which MO retries harmlessly (`context/archive/2026-10-06-week-resubmission-replace/plan.md:260-261`).

**Production is already on the latest migration.** Replaying the historical migrations over seeded data checks events that have already happened. Replay pays off as a reusable pattern for the next migration: seed at the latest version, apply the new file, re-run the rule tests.

### Mechanisms available

- **Replay.** `npx supabase db reset --version <ts>` resets to a version, and `npx supabase migration up --local` applies the rest (CLI 2.120.0 help, checked 2026-10-10). Seeding can go in `supabase/seed.sql` (enabled but missing) or `--sql-paths`. On the developer machine, `db reset` wipes the local stack shared with `npm run dev` and other worktrees (memory: parallel worktrees share one Supabase stack). In CI the runner is fresh.
- **SQL clock.** There is no seam: `now()` is the transaction start, and every function sets `search_path = ''` (17 functions, `grep search_path supabase/migrations`), which blocks shadowing.
- **TS clock.** `todayInWarsaw(now)` and every service and helper take the clock or `today` as a parameter, so week selection can be tested with fixed dates. The pages are the only callers of `new Date()`.

## Code References

- `src/lib/plans.ts:24-28`: `todayInWarsaw`, the single TS "today"
- `src/lib/services/plans.ts:20-35,48-62,78-92,105-120`: week selection by `today`
- `src/lib/services/plans.test.ts:41-63`: argument-only "Next week" test
- `src/lib/ratings.ts:36-38`: `isRateable`
- `supabase/migrations/20261003120000_plan_choices.sql:13-30,137,195`: backfill, unique index, cut-off
- `supabase/migrations/20261008180000_rating_ordered_defaults.sql:177,275,292,317,335`: `week_started`, rating window, re-pick
- `supabase/migrations/20261009090000_repick_unsaved_upcoming_plans.sql:9-43`: date-dependent data migration
- `supabase/config.toml:60-65`: seed enabled, file missing
- `.github/workflows/ci.yml:53-56`: `supabase start` then `supabase test db`, no reset
- `vitest.config.ts:10-12`: `TZ=Pacific/Honolulu`

## Architecture Insights

- **Two places enforce the date rules.** SQL `security definer` functions enforce the write rules (cut-off, window, `week_started`). TS services do the read-side selection (This week, Next week, history) with a `today` string. So the cheapest layer for each half differs: pgTAP for the writes, Vitest with fixed `today` values against a fake PostgREST that filters real rows, or pgTAP against the same predicates, for the reads.
- **pgTAP conventions to reuse:** transaction plus rollback, fixed UUIDs, `pg_temp` helpers (currently duplicated across files), and role impersonation through `request.jwt.claims`.
- **The deploy window is a documented contract:** "a migration must keep the old code working" (`docs/deployment.md:11-18`). The existing migrations meet it by never changing signatures.

## Historical Context (from prior changes)

- `context/archive/2026-09-30-mo-weekly-delivery/plan.md:16,102,324-330`: Warsaw chosen because MO computes `week_start` in Warsaw. Specifies the `todayInWarsaw` boundary example (22:30Z → next day).
- `context/archive/2026-10-03-swap-and-save-plan/plan.md:39,81-83`: no per-user time zone; pgTAP fixtures relative to Warsaw today (T+1, T).
- `context/archive/2026-10-06-week-resubmission-replace/plan.md:33,46,95,104,123,260-261`: `week_started` reuses the cut-off expression. Old Worker maps it to 500 during the window.
- `context/archive/2026-10-07-rate-recent-meals/plan.md:26,48`: window predicate, with a worked example (on Wed 14 Oct, the 7th is rateable and the 6th is not).
- `context/archive/2026-10-08-next-week-nearest-upcoming/plan.md:13-23,56,73-91`: the "latest wins" ordering bug (W+1 unreachable when W+2 was also delivered). The fix was pinned by an argument-level unit test. The plan notes "the smoke can't move the clock".
- `context/archive/2026-10-08-rating-ordered-options/reviews/impl-review-phase-2.md:72-80`: deploy-window effect accepted.
- `context/foundation/lessons.md`: run `npx supabase test db` with full output saved to a log on the shared stack, and never pipe it through `tail`.

## Related Research

- `context/archive/2026-10-08-next-week-nearest-upcoming/` (frame and plan) for the week-selection bug. No other research covers testing strategy.

## Open Questions

Decisions for `/10x-plan`. None blocks it, but each changes the phase list.

1. **SQL clock control.** Options:
   - **(a)** Add a `today` helper (for example `private.warsaw_today()`) that every date check calls. Tests could then shift "today", and a regression to UTC would fail every run. This changes production SQL and touches four live functions, under the deploy-window rule.
   - **(b)** Keep relative-date tests and add a cheap static check that every date comparison in `supabase/migrations/` uses the Warsaw expression (no `current_date`, no bare `now()::date`).
   - **(c)** Accept the current gap.

   (b) costs the least. (a) gives the real signal test-plan §2 #5 asks for ("Server time equals the user's date" must be challenged).
2. **Scope of the migration replay.** Choose between:
   - a reusable harness (seed realistic rows at the latest version, apply a new migration, re-run the rule tests), as a local or CI step;
   - a retroactive replay of `20261003120000` and `20261009090000`.

   Production is already past both. Also choose where a replay may run without wiping the shared dev stack: CI only, or a separate local project.
3. **"Old Worker against new schema" check.** The signature-stability rule could be a pgTAP assertion on function signatures (cheap, catches a drop or rename) or a smoke run of the previous `master` against the new schema (expensive).
4. **Week-selection tests.** Choose between:
   - unit tests against a fake PostgREST that applies the filters to real rows;
   - moving the `This week`/`Next week`/history predicates into SQL and testing them in pgTAP.

   The second would also be a production change.
