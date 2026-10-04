<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dashboard PGRST303 Retry

- **Plan**: context/changes/dashboard-pgrst303-retry/plan.md
- **Scope**: Phase 1 of 2
- **Reviewed phases**: 1
- **Date**: 2026-10-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned eslint.config.js allowlist entry

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:94
- **Detail**: Not in the plan's "Changes Required". `src/lib/postgrest-retry.ts` was added to the `no-console: off` Workers-logs allowlist so the planned `console.warn` passes `npm run lint`. It follows the convention used for `plan-save.ts` and `dashboard.astro`, and it scopes the exception to this one file. It doesn't weaken the rule anywhere else.
- **Fix**: Accept as is. The plan requires the warning, and this is the repo's way to allow one.
- **Decision**: ACCEPTED — kept as is (follows the Workers Logs allowlist convention)

### F2 — Only getUpcomingPlan's wiring is pinned by a test

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/plans.test.ts
- **Detail**: The plan asked for exactly one service-level wiring test, and that's what exists. The wrapping of `getCurrentPlan`, `getPlanRecency` and both `savePlan` RPCs is checked only by the manual code review (1.5). That review was confirmed: all five calls pass a factory. A future refactor could drop a wrapper without any test failing.
- **Fix**: Accept as planned. Adding wiring tests for the other four is optional hardening.
- **Decision**: ACCEPTED — kept as planned (one wiring test)
