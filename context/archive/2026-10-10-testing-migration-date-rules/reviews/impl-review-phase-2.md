<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Migration and Date-Rule Safety

- **Plan**: context/changes/testing-migration-date-rules/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

All three planned files match the plan. Every expected value traces to the PRD or `docs/api.md`, not to the code under test. Two adaptations were declared, and both are justified: an extra "T-7 is history only" case with weeks 10-12 and 10-26, and a fake that also throws on unsupported options and unknown tables. The pin sits inside `begin … rollback` on every path, and other connections never see it, because the catalog change stays uncommitted. Fixture ids collide with no other file. The automated criteria were re-run on 2026-10-10 and all pass: pgTAP 9 files / 231 tests, Vitest 180, lint, astro check.

## Findings

### F1 — A dropped `.order()` in `getUpcomingPlan` would go unnoticed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/plans.test.ts:35-60 (fixture order), src/lib/services/plans.ts:32
- **Detail**: The fixture lists the user's weeks in ascending date order, and the fake returns rows in fixture order when no `order` is applied. If `.order("week_start", { ascending: true })` were deleted, `limit(1)` would still return 10-19, so the "nearest future week, not the latest" rule is only half protected. This is the bug class in `context/archive/2026-10-08-next-week-nearest-upcoming`. Mutation 2.5 tried only `ascending: false`, which does fail.
- **Fix**: List the signed-in user's weeks out of date order in the fixtures (e.g. 10-26 before 10-19, newest first), so each selection depends on the service's own `order`.
- **Decision**: FIXED — fixture weeks listed out of date order; deleting either `.order()` in getUpcomingPlan or getPastPlans now fails a test

### F2 — Plan's literal `gt`→`gte` mutation is caught by the fake's throw, not by behaviour

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Phase 2 Manual (Progress 2.5); src/test/fake-supabase.ts:28-35
- **Detail**: The fake doesn't implement `gte`, so the mutation as written makes five tests throw "not implemented". Progress 2.5 was instead satisfied with the equivalent bound `gt(addDays(today, -8))`, which failed exactly the "started 7 days ago is history only" test. That is valid evidence, but the plan's wording no longer describes a behavioural check.
- **Fix**: Record in change.md Notes that 2.5 used `gt(today-8)` as the `gte` equivalent, and that the fake would need `gte` before a literal `gte` mutation means anything.
- **Decision**: FIXED — note added to change.md Notes

### F3 — `getCurrentPlan`'s order and `limit(1)` are never exercised

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/plans.ts:61-62
- **Detail**: No fixture puts two of the user's weeks inside (T-7, T], so flipping to `ascending: true` or dropping `limit(1)` would still pass. `docs/api.md:65` assumes only one such week exists, so this is outside what the docs specify.
- **Fix**: None required. If wanted, add a case with weeks 10-13 and 10-15 on 10-19 expecting 10-15. That expectation goes beyond the documented oracle.
- **Decision**: SKIPPED — docs/api.md doesn't define two weeks in progress

### F4 — Some calls are bare assertions, so an unexpected raise aborts the whole file

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/date_boundaries.test.sql:151-160, 187-201, 240-246, 260-264, 293-297
- **Detail**: Statements such as `select is(public.rate_meal(…))` abort the file instead of giving one `not ok`. Mutation 2.4 showed "planned 24, ran 0" with the psql error naming line 155. The test still goes red and the cause is visible. `meal_ratings`, `plan_choices` and `rating_ordered_defaults` use the same pattern. Separately, the cut-off successes use `isnt(…, null)` where `plan_choices` uses the stricter `is(…, now())`.
- **Fix**: None required. Optionally switch the cut-off success checks to `is(…, now())` to match plan_choices.test.sql.
- **Decision**: FIXED — cut-off success checks now `is(…, now())`, as in plan_choices.test.sql; bare-call pattern kept (matches existing files)
