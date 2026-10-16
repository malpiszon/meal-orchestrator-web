---
date: 2026-10-16T17:57:18+02:00
researcher: Claude (Opus 5.5)
git_commit: 8ba0426
branch: testing-delivery-resend-integrity
repository: malpiszon/meal-orchestrator-web
topic: "S-02 delivery and re-send integrity: is the delivery write atomic, how is each payload field stored and read back, and what do existing tests already prove"
tags: [research, mo-delivery, ingest_weekly_plan, re-send, pgtap, smoke, test-plan-phase-2]
status: complete
last_updated: 2026-10-16
last_updated_by: Claude (Opus 5.5)
---

# Research: delivery and re-send integrity (S-02, #120)

**Date**: 2026-10-16T17:57:18+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 8ba0426
**Branch**: testing-delivery-resend-integrity
**Repository**: malpiszon/meal-orchestrator-web

## Research Question

For test-plan §3 Phase 2 (risks #2 and #6, `context/foundation/test-plan.md`), ground what the tests must target:

1. Is the delivery write atomic, so that a failure part-way through answers non-2xx and leaves nothing half-written? (roadmap S-02 unknown, owner research)
2. Where does each contract field land, and how can a test read it back through the owning user's view?
3. What do existing tests already prove about deliveries and re-sends, and where are the gaps?
4. Which fixtures exist for changed-week re-sends? (The question of using real dev re-sends is the user's; see Open Questions.)

## Summary

- **Atomicity: the week's rows are atomic; the delivery as a whole is not.**
  - All plan writes are in one `security definer` PL/pgSQL function, `ingest_weekly_plan`, called once per storage attempt over PostgREST. An exception anywhere in it, including after the plan row is updated and its options deleted, rolls back the whole call. Sources: `supabase/migrations/20261010120000_warsaw_today_helper.sql:156-287` (the latest definition) and `src/pages/api/mo/deliveries.ts:106`. The route answers 200 only when the RPC returns a plan id string (`deliveries.ts:155-171`).
  - So a half-written _week_ behind a 2xx is not possible on the inspected path. No test asserts this, though; there is no rollback test.
  - Account provisioning sits outside that transaction. On `unknown_user`, the route calls GoTrue (`inviteUserByEmail`, then `updateUserById`, or `createUser` as a fallback) and then calls the RPC a second time (`deliveries.ts:111-138`). This leaves three cross-system partial states:
    1. **Invitation sent, then the second ingest fails.** The answer is 500, and the account plus its invitation remain. The invite-on-first-delivery review accepted this (F3, `context/archive/2026-10-04-invite-on-first-delivery/reviews/impl-review.md:51`). MO's retry then stores the week with `account_created: false`.
    2. **Invitation fails and `createUser` succeeds.** The answer is 200, but no invitation was sent. This is documented: `docs/mo-delivery-contract.md:117`, `docs/api.md:21`.
    3. **`updateUserById` fails after a successful invite.** The answer is 200, but the account lacks `app_metadata.provisioned_by`. This is only logged (`deliveries.ts:117-120`), and no test or other code path asserts `provisioned_by`.
- **The realistic risk-#2 failure is "stored wrong", not "half-stored".** The suspects are:
  - the TS mapping `toOptionRows` (`src/lib/mo-delivery.ts:136-169`);
  - the RPC's `jsonb_to_recordset` column list (`warsaw_today_helper.sql:264-275`);
  - the user lookup `u.email = lower(p_email) and is_sso_user = false` (`:178-183`).
- **Field-level read-back is the main gap.**
  - The existing pgTAP option helper never sends `composition`, `nutrition` or `justifications` (`supabase/tests/week_resubmission.test.sql:14-19`).
  - The single fixture covers only `breakfast` and `lunch`, every variant has a composition and nutrition, and the week is 5 days (`scripts/fixtures/mo-delivery.sample.json`; MO always sends `week_start + 4`, contract :78).
  - Smoke reads back through the dashboard but matches only 1–3 names.
- **Re-send rules (risk #6) are already well covered in pgTAP.** `week_resubmission.test.sql`, `date_boundaries.test.sql:242-284` and `rating_ordered_defaults.test.sql:240-245` cover:
  - never-saved, confirmed and swapped weeks;
  - a dish that is gone;
  - a re-send with an identical body or the same body with keys reordered;
  - started and past weeks;
  - other weeks and other users unchanged.

  Smoke covers the same over HTTP for a rename-only re-send (`scripts/smoke.mjs:1050-1143`). The remaining gaps are narrower; see the gap list below.

- **HTTP status mapping is only partly exercised.**
  - Covered over HTTP: 200, 401 and 409.
  - Not covered by any test: 400 (schema, non-JSON body, `\u0000`/22P05), 413, 500 and 503. There is no route-level unit test.

## Detailed Findings

### 1. Write path and atomicity

Route order (`src/pages/api/mo/deliveries.ts:57-172`):

1. Configuration: 503 (`:59-62`).
2. Bearer token: 401 (`:65-68`).
3. Size: 413, checked against `Content-Length` and then the real byte length (`:71-77`).
4. JSON parse: 400 (`:78-83`).
5. zod validation: 400 with the issue paths (`:84-91`).
6. RPC (`:96-108`).
7. On `P0002 unknown_user`: provisioning, then a second RPC call (`:111-138`).
8. Error mapping:
   - `22P05` gives 400 (`:140-149`);
   - `55000 week_started` gives 409 (`:150-154`);
   - any other error gives 500 `storage_failed`, reported to Sentry (`:155-161`);
   - a non-string result gives 500 `no_plan_id` (`:162-168`).
9. 200 `{plan_id, week_start, account_created}` (`:171`).

`ingest_weekly_plan` (`warsaw_today_helper.sql:156-287`), in this order:

1. Look up the user and raise `P0002` if there is none (`:178-187`).
2. Lock or claim the plan row for (user, week) with `for update`, or with `insert … on conflict do nothing` in a loop (`:192-211`).
3. For a re-send:
   - an identical `raw_payload` returns the existing id (`:213-216`);
   - `p_week_start <= private.warsaw_today()` raises `55000` (`:218-220`);
   - if the plan was saved, it captures the chosen `(date, type, provider_meal_id)` (`:223-232`);
   - it updates `provider`, `week_end`, `mo_run_id`, `raw_payload` and `received_at`, and leaves `saved_at` alone (`:235-241`).
4. Delete all option rows (`:244`).
5. Insert the new options, choosing the kept dish (the lowest `variant_index` when offered twice) (`:248-280`).
6. `pick_default_choices` fills every other slot (`:283`). It orders by rating-adjusted score, then score, then `variant_index` (`20261008180000_rating_ordered_defaults.sql:49-95`).

Database guards that can raise _after_ the update and delete, and so can drive a rollback test:

- `score between 1 and 10` (`20261001120000_weekly_plans.sql:31`);
- `unique (plan_id, meal_date, meal_type, variant_index)` (`:33`);
- the `not null` columns `name` and `provider_meal_id` (`:25-26`);
- the partial unique index `plan_meal_options_one_chosen_per_slot` (`20261003120000_plan_choices.sql:18`).

The RPC does not check:

- `meal_type` against `MEAL_TYPES` (the column has no check constraint, `weekly_plans.sql:23`);
- option dates against the week;
- that `p_options` agrees with `p_raw`.

The route enforces all three through zod and `toOptionRows`, so they are TS-only guarantees.

Deleting option rows cascades to `meal_ratings` (FK `on delete cascade`, `20261008120000_meal_ratings.sql:21`). A re-send only reaches the delete for an upcoming week (`:218-220`), and a meal can't be rated before its day (`docs/api.md:108`), so a re-send loses no ratings on this path.

### 2. Where each contract field lands and how it is read

- **Owner read path in the app.** `PLAN_SELECT = "id, provider, week_start, week_end, received_at, saved_at, plan_meal_options(*, meal_ratings(rating))"` (`src/lib/services/plans.ts:8-9`) is used by `getUpcomingPlan`, `getCurrentPlan` and `getPastPlan`.
- **Rendering.** `WeekPlan.astro`/`MealSlot.astro` render "This week" and history; `UpcomingWeekEditor.tsx`, with props mapped at `src/pages/dashboard.astro:77-86`, renders "Next week".

| Contract field                    | Stored as                                                                                               | Read / rendered                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schema_version`                  | `raw_payload` only                                                                                      | not read                                                                                                              |
| `run_id`                          | `weekly_plans.mo_run_id`, `raw_payload`                                                                 | not read by the app                                                                                                   |
| `provider`                        | `weekly_plans.provider`                                                                                 | selected but not rendered; scopes recency and ratings in SQL                                                          |
| `week_start` / `week_end`         | `weekly_plans`                                                                                          | `formatWeekRange` in `WeekPlan.astro:27`, `dashboard.astro:141`, `history/index.astro:62` and `history/[id].astro:36` |
| `user.email`                      | `auth.users`, matched by `lower()`                                                                      | indirect: the plan's `user_id`                                                                                        |
| `days[].date`                     | `plan_meal_options.meal_date`                                                                           | `groupPlanOptions` (`src/lib/plans.ts:66-111`), day labels                                                            |
| `meals[].type`                    | `meal_type`                                                                                             | slot label; slots appear in `MEAL_TYPES` order, unknown types are skipped (`plans.ts:75,93`)                          |
| `variants[]` order                | `variant_index`                                                                                         | tie-break only (`plans.ts:71`)                                                                                        |
| `provider_meal_id`                | stored                                                                                                  | not rendered; used for recency, ratings and keeping choices on a re-send                                              |
| `name`, `score`, `justifications` | stored                                                                                                  | rendered (`MealSlot.astro:37,41,44-52,65,69`; `UpcomingWeekEditor.tsx:88,97,112-117`)                                 |
| `composition`                     | stored (`""` becomes `null`, `mo-delivery.ts:158`)                                                      | not rendered (`dashboard.astro:74` drops it)                                                                          |
| `nutrition`                       | stored (a missing object becomes `null`, `mo-delivery.ts:159`; unknown nested keys are stripped by zod) | not rendered                                                                                                          |
| derived `is_recommended`          | stored                                                                                                  | not used by the UI; the default choice comes from `pick_default_choices`                                              |

**Readable as the owner in pgTAP.** The `weekly_plans` and `plan_meal_options` SELECT policies use `user_id = auth.uid()` (`weekly_plans.sql:41-51`), and `authenticated` holds SELECT (asserted at `supabase/tests/rpc_contract.test.sql:137-141`). The owner can therefore read every column, including `raw_payload`, `composition` and `nutrition`.

The existing pattern to copy:

- deliver as `set local role service_role`;
- read as `set local role authenticated` with `request.jwt.claims` `{"sub": …}` (`week_resubmission.test.sql:163-164`).

**Week selection is TS only** (`src/lib/services/plans.ts:20-70`):

- "Next week" is the nearest `week_start > today`.
- "This week" is the latest `week_start` with `today - 7 < week_start <= today`.

The re-send "started" rule in SQL is the same boundary seen from the other side (`warsaw_today_helper.sql:218`). Week selection is already unit-tested against fake rows (`src/lib/services/plans.test.ts:41-105`) and covered in smoke (`smoke.mjs:1136-1143`).

### 3. What existing tests prove

- **`src/lib/mo-delivery.test.ts`** (zod and `toOptionRows`):
  - the sample is accepted;
  - every contract rejection rule, checked with its issue path (`:43-154`);
  - `""` composition becomes `null` (`:33`);
  - one recommended option per slot, ties going to the lowest index (`:167-177`);
  - `variant_index` follows the array order (`:190`).
  - Not asserted: the mapping of `name`, `score`, `nutrition`, `justifications` or `run_id`.
- **`supabase/tests/week_resubmission.test.sql`**: the re-send oracle.
  - A never-saved week follows the new picks and `saved_at` stays null (`:130-157`).
  - Saved by confirm: the old choices are kept and `saved_at` is unchanged (`:175-199`).
  - Saved by swap: the dish is kept (the lowest index when offered twice), a new slot gets the pick, and another user's same week is untouched (`:219-249`).
  - Identical body, and the same body with keys reordered: a full no-op including `received_at` (`:262-281`).
  - Dish gone: that slot falls back and the others are kept (`:292-319`).
  - Started or past week: `55000`, nothing changed; an identical re-send of a started week still returns its id (`:340-370`).
  - First delivery of a past week (`:378-385`).
  - The `state()` snapshot compares other weeks and other users byte for byte.
  - Dates come from the real Warsaw today (`:10-11`), not a pinned one.
- **`supabase/tests/date_boundaries.test.sql:242-284`**, with today pinned to 2026-03-30: re-sends at T-1, T and T+1.
- **`supabase/tests/rating_ordered_defaults.test.sql:198-245`**:
  - `is_recommended` is stored as delivered;
  - the pick at ingest follows ratings;
  - on a saved re-send, a slot whose dish is gone gets the rating-adjusted pick.
- **`supabase/tests/plan_choices.test.sql:203-251`**:
  - a re-delivery after a swap keeps the plan row and `saved_at`;
  - a first delivery leaves the plan unsaved with `is_chosen = is_recommended`.
- **`supabase/tests/rpc_contract.test.sql:87-120`**: the `ingest_weekly_plan` signature and grants, and the columns the Worker reads. It never calls ingest.
- **`scripts/smoke.mjs`**:
  - no token gives 401 (`:715`);
  - anon calling the RPC gets 42501 (`:722`);
  - a new email gives `account_created: true` (`:738`);
  - current, upcoming and past deliveries (`:743-936`);
  - an identical re-delivery returns the same `plan_id` and the swap is kept (`:1050-1061`);
  - a changed re-send of the current week gives 409 and the week stays (`:1075-1080`);
  - a changed upcoming re-send gives 200, shows the new name, keeps the swap and still reads "Saved" (`:1090-1124`);
  - "Next week" stays on the nearer week (`:1136-1143`);
  - a provisioned account can claim itself (`:1427-1436`).
  - Deliveries come from `loadDelivery` (`:167-180`), which shifts the sample to a given Monday.
- **`tests/e2e/support/deliveries.ts:52-66`**: `deliverWeek` asserts only a 2xx.

### 4. Gap list against risk #2 and risk #6

**Stored exactly (risk #2)**

- No round trip compares a whole payload with what the owner reads back: every slot, each option's `name`, `composition`, `nutrition`, `score`, `justifications`, `variant_index`, `provider_meal_id`, and the plan's `provider`, `week_end` and `mo_run_id`.
- No payload carries:
  - meal types other than `breakfast`/`lunch`;
  - an empty `composition`;
  - a missing `nutrition`, or a partial one;
  - zero justifications;
  - a 7-day week;
  - unknown nested keys (which must stay in `raw_payload` only).
- Account mapping:
  - no test covers a mixed-case email reaching the existing lowercase account (`lower()` at `warsaw_today_helper.sql:181`);
  - no test shows that a delivery for user A never lands on user B (smoke implies it only through the dashboard of the user it delivered to).
- Atomicity: no test raises inside ingest after the update and delete and then asserts the prior state is intact.
- HTTP mapping: nothing tests 400 for schema, non-JSON or `\u0000`, 413, 500 or 503 over HTTP, or `provisioned_by` after provisioning.

**Re-send (risk #6)**

Not yet covered:

- a re-send that removes a day or a slot;
- a re-send that changes `week_end` or `provider`;
- a re-send that differs only in `run_id` (the pgTAP tests vary a raw `v` key; smoke keeps `sample-run-0000`);
- a re-send of the upcoming week while a later week exists, checked on both weeks' rows;
- concurrent deliveries (the insert-on-conflict loop);
- the rating-adjusted fallback when a kept dish is gone. Contract :133 says the fallback "follow[s] MO's new recommendations", while `docs/api.md:76-78,97` says "suggested pick" (rating-adjusted). See Open Questions.

## Code References

- `src/pages/api/mo/deliveries.ts:57-172`: the route: order of checks, provisioning and error mapping
- `src/lib/mo-delivery.ts:86-169`: `moDeliverySchema` and `toOptionRows`
- `supabase/migrations/20261010120000_warsaw_today_helper.sql:156-292`: the current `ingest_weekly_plan`
- `supabase/migrations/20261008180000_rating_ordered_defaults.sql:49-95`: `pick_default_choices`
- `supabase/migrations/20261001120000_weekly_plans.sql:6-54`: tables, constraints, RLS
- `src/lib/services/plans.ts:8-126`: owner read path and week selection
- `supabase/tests/week_resubmission.test.sql`: re-send pgTAP and its helpers (`pg_temp.o`, `send`, `state`)
- `supabase/tests/date_boundaries.test.sql:19-26`: pinning today
- `scripts/smoke.mjs:146-180,385,715-1143`: delivery helpers and checks
- `scripts/fixtures/mo-delivery.sample.json`: the only fixture

## Architecture Insights

- The trust boundary is split:
  - **TS guarantees:** the zod schema (dates within the week, the meal-type enum, uniqueness, `.min(1)` days so a re-send can't wipe a week) and `toOptionRows` (`is_recommended`, `variant_index`, `""` becomes `null`).
  - **SQL guarantees:** the lookup, the replace rules, atomicity and the DB constraints.

  A risk-#2 test that covers only one side misses mapping bugs on the other. A round trip needs to go route, then RPC, then the owner's read: either smoke over HTTP plus a read as that user, or pgTAP fed with `toOptionRows` output, with the expected values written independently from the contract.

- The route can't be unit-tested in Vitest as it stands, because it imports `astro:env/server` (`mo-delivery.ts:6-7` keeps `astro:env` out for exactly this reason). Status mapping is therefore smoke territory, unless the mapping is extracted into `src/lib/`.
- Expected values must come from `docs/mo-delivery-contract.md` (`test-plan.md` §1). The contract defines:
  - `""` composition stored as "no composition";
  - menu order kept;
  - unknown nested keys kept only in the raw payload;
  - the email matched case-insensitively;
  - the idempotency order: identical, then started, then replace.

## Historical Context (from prior changes)

- `context/archive/2026-09-30-mo-weekly-delivery/plan.md:52`: one transactional `security definer` RPC is the only writer.
  - `reviews/impl-review-phase-2.md:30-41`: an empty `days` would wipe a week, which led to `.min(1)`.
  - `reviews/impl-review.md:26-38`: the race between concurrent first deliveries was fixed with the claim loop.
- `context/archive/2026-10-04-invite-on-first-delivery/reviews/impl-review.md:37,51`: F2 (invite fails, still 200) and F3 (account and invitation left behind after a failed second ingest) were accepted.
  - `impl-review-phase-1.md:28`: F1, a missing `provisioned_by`, is only logged.
- `context/archive/2026-10-06-week-resubmission-replace/plan.md:31-73,127-136`: the replace rules and the snapshot comparison.
  - `plan-brief.md:74`: a dish dropped from a saved plan silently falls back while the plan still reads "Saved".
  - `reviews/impl-review.md:33`: a stale "Keep these picks" confirm (parked, `roadmap.md:321`).
  - `reviews/impl-review.md:66-75`: re-posting an older run's payload counts as changed.
- `context/archive/2026-10-10-testing-migration-date-rules/`: S-01 delivered the pinned today, the RPC contract test and the replay harness this change builds on (`test-plan.md` §6.1, §6.5).
- **Assessment of the roadmap/issue claim "mo-web has no monitoring" (`roadmap.md:116`, `test-plan.md` risk #2): partially stale.**
  - Since `2026-10-11-add-sentry`, 500 `storage_failed` and `no_plan_id` are reported to Sentry (`deliveries.ts:156-167`).
  - Still true: a 2xx with a bad save is invisible, and invitation failures are only `console.error`'d (`deliveries.ts:126`). S-10 (#145) covers the invitation failures.

## Related Research

- Not applicable. No research documents cover this area under `context/changes/**`. The relevant archive material is plans and reviews, cited above.

## Open Questions

1. **Real dev re-sends as fixtures (owner: user, roadmap `S-02`).**
   - No captured payload is committed; `scripts/fixtures/` holds only the sample.
   - MO keeps every sent body as `<artifacts>/<run_id>/<user_id>/mo_web_payload.json` (contract :163-176), subject to retention. Two dev runs for the same upcoming week would give a real changed-week pair.
   - The alternative is hand-built variants of the sample (drop a dish, add or remove a slot, change `run_id`).
2. **Sequencing with S-10 (#145, open, assigned to the user).** S-10 changes the contract (`invitation_sent`, a distinct `not_configured`) and the provisioning branch of this same route (`roadmap.md:218-230`). Tests for the provisioning or invitation partial states written here would need to change with it. Either sequence the two branches or keep S-02's provisioning assertions to what S-10 won't change.
3. **Contract wording drift.**
   - Contract :133 says a never-saved re-send "follow[s] MO's new recommendations", but ingest uses the rating-adjusted suggested pick (`rating_ordered_defaults.sql:49-95`; `docs/api.md:96-97`).
   - PRD US-07/FR-017 (`prd.md:118-123,192`) still say the latest delivery always replaces the stored one, while a changed re-send of a started week is refused with 409 (since S-06).
   - The plan should decide which document is the oracle for each assertion and fix the stale wording in the same PR (CLAUDE.md docs rule).
4. **Is the cross-system partial state (account plus invitation, no week, 500) in scope?** It is documented and accepted (F3). A test can pin the documented behaviour: MO's retry stores the week and sends no second invitation. Making provisioning atomic is out of scope for a test-only change.
