<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recency-annotated plan

- **Plan**: context/changes/recency-annotated-plan/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Notes: all four planned files match their contracts (commit 804864a). The `PLAN_SELECT` extraction in `src/lib/services/plans.ts` is a benign in-scope refactor. Gates re-run during review: `npx supabase db reset`, `npm test` (45 passed), `npm run lint`, `npx astro check`, all green.

## Findings

### F1 — get_plan_recency rules have no automated regression test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20261002190000_plan_recency.sql
- **Detail**: The function encodes the north star's matching rules: offered-only options excluded, same provider only, strictly earlier date, earlier days of the same plan count, RLS isolation, anon revoked. They were verified once with a rolled-back SQL script that lives only in the session scratchpad (rows 1.4/1.5). Phase 3's smoke covers just one positive case, a recommended meal 7 days earlier. S-03 is planned to rewrite the "planned" predicate, so the negative cases are exactly what can silently regress then.
- **Fix A ⭐ Recommended**: Commit the check as a pgTAP test (`supabase/tests/get_plan_recency.test.sql`) and run `npx supabase test db` in the CI smoke job, which already starts local Supabase.
  - Strength: Pins every term definition from the plan. Runs on the stack CI already boots, and S-03 gets a ready safety net.
  - Tradeoff: Adds a test type and one CI step that the plan did not list (small scope addendum).
  - Confidence: MED — pgTAP ships with the Supabase CLI stack, but not yet exercised in this repo.
  - Blind spot: Have not checked that the pgTAP extension is enabled in the local config.
- **Fix B**: Keep the SQL script in the change folder as a documented manual check, and note in S-03's plan to re-run it.
  - Strength: No new tooling or CI change.
  - Tradeoff: Relies on someone remembering to run it.
  - Confidence: HIGH — trivial to do.
  - Blind spot: Archive moves the script out of sight.
- **Decision**: FIXED via Fix A — supabase/tests/get_plan_recency.test.sql (5 assertions; went red when the is_recommended predicate was removed), `supabase test db` step in the CI smoke job, README CI note

### F2 — formatRecency silently formats non-earlier dates

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/plans.ts:140
- **Detail**: With `lastPlannedOn >= mealDate` it returns "In your plan 0 days earlier" or a negative count. Today the SQL `h.meal_date < o.meal_date` guarantees the precondition, so nothing is broken. The precondition is just unstated.
- **Fix**: State the precondition ("`lastPlannedOn` is strictly before `mealDate`, as `get_plan_recency` guarantees") in the JSDoc.
- **Decision**: FIXED — precondition stated in formatRecency's JSDoc
