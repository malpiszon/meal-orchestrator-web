<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan history list

- **Plan**: context/changes/plan-history-list/plan.md
- **Scope**: Phase 1 of 2
- **Reviewed phases**: 1
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Week page has no h1 when a plan is shown

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/history/[id].astro:35-53
- **Detail**: The header holds only the "Back to past plans" link and `WeekPlan` starts at `<h2>` (the week range), so the main case has no `<h1>`. The not-found and error branches, `history/index.astro` and `dashboard.astro` all have one.
- **Fix**: Put an `<h1>` "Past plan" in the header next to the back link, the way `history/index.astro` does it, and keep the cards' titles as `h1` only when no plan is shown (or demote them to `h2`).
- **Decision**: FIXED — header has h1 "Past plan"; error and not-found card titles are h2

### F2 — eslint.config.js changed outside the plan's file list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:82,90
- **Detail**: `src/pages/history/**/*.astro` was added to the `no-console` allowlist. The plan requires the pages to log `history load failed`, and `dashboard.astro` is on the same list, so the change is needed and harmless; the plan just didn't name the file.
- **Fix**: Accept as is; mention it in the PR description.
- **Decision**: FIXED — accepted as is; noted in change.md for the PR description

### F3 — Browser tab title is the same for every past week

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/history/[id].astro:33
- **Detail**: `<Layout title="Past plan">` is fixed, so several open past weeks are indistinguishable in tabs and history.
- **Fix**: Use `formatWeekRange(plan.week_start, plan.week_end)` as the title when a plan is found, else "Plan not found".
- **Decision**: FIXED — `<Layout title>` is the week range when a plan is found, else "Past plan"
