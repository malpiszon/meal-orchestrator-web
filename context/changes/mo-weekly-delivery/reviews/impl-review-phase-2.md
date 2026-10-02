<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: MO Weekly Delivery (S-01)

- **Plan**: context/changes/mo-weekly-delivery/plan.md
- **Scope**: Phase 2 of 4
- **Reviewed phases**: 2
- **Date**: 2026-10-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Notes:

- **Drift check:** all 8 planned changes match the plan. Every validation rule is enforced. The RPC parameters and option-row keys match `ingest_weekly_plan`, and all 30 `provider_meal_id` values in the sample exist as `configurable_product_id` in the MO raw fixtures. There are four additions the plan doesn't list, all benign: the `zod` dependency, the eslint `no-console` override for `src/pages/api/mo/**`, extra rows in the contract doc, and a defensive check for a non-string plan id.
- **Automated checks re-run 2026-10-01:** `npm test` (12 passed), `npm run lint`, `npx astro check` (0 errors) and `npm run build` all pass.
- **Pre-existing, not caused by this phase:** `src/pages/api/auth/*.ts` don't export `prerender = false`, which the CLAUDE.md hard rule requires.

## Findings

### F1 — An empty `days` array silently wipes a stored week

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/mo-delivery.ts:101 (`days`), src/lib/mo-delivery.ts:79 (`meals`)
- **Detail**: `days: z.array(daySchema)` and `meals: z.array(mealSchema)` have no minimum length. `ingest_weekly_plan` upserts the plan and then deletes all of its options. So a buggy MO run that sends `"days": []` (or days with no meals) for a week that's already stored returns 200 and leaves an empty plan. Nobody gets alerted.
- **Fix**: Add `.min(1)` to both `days` and `meals`, add a rejection test for each, and add the rule to the contract doc's payload table.
  - Strength: The bad payload gets a 400, which MO already alerts on and doesn't retry, so the stored week stays intact.
  - Tradeoff: MO can no longer send "no menu this week" as an empty delivery. MO never does that today: `CanonicalMenu` always has days.
  - Confidence: HIGH — two one-line schema changes.
  - Blind spot: Holiday weeks with fewer than 5 days still pass, which is correct (1 to 7 days are allowed).
- **Decision**: FIXED — `.min(1)` on `days` and `meals`, two rejection tests, contract rows updated

### F2 — Rejection tests don't check which rule fired, and the Monday test protects nothing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/mo-delivery.test.ts:14-18, src/lib/mo-delivery.test.ts:37-43
- **Detail**:
  - `rejects()` returns only `!success`, so a test passes whenever the payload is rejected for any reason.
  - The Monday test sets `week_start = "2026-06-30"`, which puts `days[0].date` (2026-06-29) outside the week. The test would still pass with the Monday check deleted (confirmed by reading the test).
  - Several rules that are enforced have no test: duplicate date, `week_end` out of range, duplicate `provider_meal_id`, 0 or 11 variants, more than 5 justifications.
- **Fix**:
  - Make `rejects()` return the issue paths and assert the expected path in each test, e.g. `["week_start"]`.
  - Use Sunday `2026-06-28` for the non-Monday case; every date stays within 6 days of it, so only the Monday rule can fire.
  - Add the missing rule tests.
- **Decision**: FIXED — `issuePaths()` asserts the exact failing path(s); Monday case uses Sunday 2026-06-28 (break-check: test goes red with the Monday rule disabled); added week_end range, duplicate date, 0/11 variants, duplicate provider_meal_id, non-integer score, >5 justifications

### F3 — A NUL character in a string leads to retries that can never succeed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:85-87
- **Detail**:
  - A string containing `\u0000` passes zod, but Postgres jsonb and text reject it. The endpoint then returns 500 `storage_failed`.
  - The contract tells MO to retry 500s, so MO keeps retrying a payload that will never be accepted.
  - Separately, the comment "The body as received (validated)" overstates things: only the top level is strict, and nested unknown keys are stored unvalidated.
- **Fix**: Return 400 for Postgres error code `22P05`, or reject `\u0000` in schema strings. Reword the comment to "top-level validated; nested unknown keys kept".
- **Decision**: FIXED — Postgres `22P05` (confirmed as the RPC's code for `\u0000`) now returns 400 `invalid_payload`; p_raw comment reworded

### F4 — Body size is unbounded

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:66
- **Detail**: Neither the body nor any string field has a size cap. A huge body could exceed the Workers free plan's 10 ms CPU limit (error 1102). Only the authenticated, trusted MO can reach this code, so the risk is low.
- **Fix**: Before `request.json()`, return 413 when `Content-Length` is over 256 KB (the sample is about 42 KB).
- **Decision**: FIXED — 413 `payload_too_large` above 256 KB (Content-Length precheck plus actual byte length), after the token check; contract table and check order updated

### F5 — Public sign-up may let someone set a password on an account a delivery created (S-04)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:96-99 (account provisioning)
- **Detail**:
  - Accounts that deliveries create stay unconfirmed, and `/auth/signup` is still public until S-04.
  - If GoTrue lets a new sign-up for an existing unconfirmed email set the password, a third party could plant a password before the real user accepts their invite. This is the "pre-account takeover" pattern.
  - Not verified against our GoTrue version. Production has no provisioned accounts until this PR merges and MO delivers.
- **Fix**: Record it on issue #8 (S-04) as an open question to verify. S-04 already plans to remove public sign-up; make sure that lands before or together with the first production delivery, or verify GoTrue's behaviour now.
  - Strength: Puts the risk next to the change that closes it, without growing S-01.
  - Tradeoff: Between this merge and S-04, production depends on nobody racing the invite.
  - Confidence: MED — the risk depends on GoTrue behaviour we haven't tested.
  - Blind spot: Whether production requires email confirmation, which would limit the risk to a user who clicks a confirmation link they didn't ask for.
- **Decision**: DISMISSED — self sign-up is already disabled in production Supabase (2026-09-24, `context/foundation/infrastructure.md`, commit 9b85dbf): GoTrue answers `Signups not allowed for this instance`, so no one can sign up over a provisioned email. Local dev keeps sign-up on for smoke only

### F6 — `MEAL_TYPES` and `MealType` can drift apart

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/mo-delivery.ts:10-17, src/types.ts
- **Detail**: `satisfies readonly MealType[]` only proves that `MEAL_TYPES` contains no unknown values, not that it contains all of them. If a member is added to `MealType` in src/types.ts, the schema would silently reject it. Phase 3 will reuse both for slot ordering.
- **Fix**: Define `MEAL_TYPES` as a const tuple in src/types.ts and derive `MealType = (typeof MEAL_TYPES)[number]`. mo-delivery.ts imports the tuple.
- **Decision**: FIXED — `MEAL_TYPES` const tuple lives in src/types.ts and `MealType` is derived from it; mo-delivery.ts imports it
