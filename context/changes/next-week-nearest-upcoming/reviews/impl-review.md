<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: "Next week" Shows the Nearest Upcoming Week

- **Plan**: context/changes/next-week-nearest-upcoming/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Evidence: all five planned changes match their contracts (`plans.ts` ascending order + JSDoc; new order/filter unit test, red on the old order; smoke repeat meal, `repeatNote` singular/plural, two-future-weeks step, JSDoc/comment updates; README rule sentence, step 6, smoke paragraph). No files outside the plan besides change-folder docs and the roadmap status flip. No SQL, endpoint or migration touched. Re-ran lint (pass) and `npm test` (133 pass) at HEAD; build, astro check and smoke passed on the same code at 5edf7be (only README wording changed after). Manual 1.6 and 1.7 were confirmed by the user against :4323.

## Findings

### F1 — Issue #84 DoD item done but unticked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: GitHub issue #84, "Definition of done"
- **Detail**: "Smoke covers two future weeks delivered at once; the recency smoke step and README walkthrough reworked to match" is done in 5edf7be, but still `[ ]`. CLAUDE.md asks to tick DoD boxes as they settle.
- **Fix**: Tick that box in #84's body.
- **Decision**: FIXED (box ticked in #84)

### F2 — Over-long JSDoc line in getUpcomingPlan

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/plans.ts:14
- **Detail**: The new JSDoc line is 122 characters; the surrounding comment lines wrap at about 105.
- **Fix**: Rewrap the JSDoc paragraph to match its neighbours.
- **Decision**: FIXED (rewrapped)
