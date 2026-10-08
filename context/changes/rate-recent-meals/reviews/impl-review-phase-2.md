<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rate Recent Meals

- **Plan**: context/changes/rate-recent-meals/plan.md
- **Scope**: Phase 2 of 4
- **Reviewed phases**: 2
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Notes

- Every planned file exists and matches its contract: `src/lib/ratings.ts` (+ test), `src/lib/services/ratings.ts`, `src/pages/api/ratings.ts` (`prerender = false`, uppercase `POST`, zod `z.int().min(1).max(5).nullable()`, every response code in the plan).
- Unplanned: `eslint.config.js` adds the route to the Workers-log `no-console` allowlist, as for `src/pages/api/plans/**`. The route needs it to log failed saves. `src/lib/services/ratings.test.ts` is an extra test of the error-kind mapping.
- `isRateable` matches `rate_meal`'s predicate (`today - 7 <= meal_date <= today`). The break-check showed the tests fail when the bound or the error mapping is changed.
- Gates: `npm test` (132 passed) and `npm run lint` were re-run for this review. `npx astro check` (0 errors) and `npm run build` passed on the same tree during implementation. Manual check 2.4 was run against `npm run dev` with a throwaway local account: 200 `{"rating":5}`, 409 `not_rateable` for an upcoming meal, 200 `{"rating":null}` for a clear, 400 for rating 6 and 401 without a session.

## Findings

### F1 — Request handling duplicated from handlePlanSave

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/ratings.ts:27-60
- **Detail**: The config, auth, 4 KiB cap, JSON parse and zod steps (including the `json` helper and the issue mapping) are copied from `src/lib/plan-save.ts:36-73`. The plan asks for this ("structured like `handlePlanSave`"), and `handlePlanSave` can't be reused as it is, because it requires `planId` and re-reads recency. With two copies, a change to the error shape or the size cap has to be made twice.
- **Fix**: Leave it as it is for now. Extract a shared `readJsonRequest(context, schema)` helper only if a third cookie-session JSON route appears.
  - Strength: Phase 2 stays within the plan's scope, and `plan-save.ts` is left alone.
  - Tradeoff: About 30 lines are duplicated until the extraction is done.
  - Confidence: HIGH — the only consumers are these two routes.
  - Blind spot: Phase 4's smoke steps will check the response shapes of both routes, but that doesn't prevent the two copies from drifting apart.
- **Decision**: FIXED (fixed differently: extracted `readJsonRequest` in `src/lib/json-request.ts`, used by `src/lib/plan-save.ts` and `src/pages/api/ratings.ts`)
