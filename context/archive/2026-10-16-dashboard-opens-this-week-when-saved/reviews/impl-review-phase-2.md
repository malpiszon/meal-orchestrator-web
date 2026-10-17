<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Dashboard Opens "This week" Once Next Week Is Saved

- **Plan**: context/changes/dashboard-opens-this-week-when-saved/plan.md
- **Scope**: Phase 2 of 2
- **Reviewed phases**: 2
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated criteria re-run on 3d9334f: `E2E_PORT=4325 npm run test:e2e` 3 passed; `npm run lint` 0 errors (2 pre-existing `no-console` warnings in `src/lib/report-handled-error.ts`); `npx astro check` 0 errors. Manual 2.3 (CI `e2e` job on the PR) pending, as the PR is not open yet.

## Findings

### F1 — docs/testing.md doesn't say the journey checks the default tab

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: docs/testing.md:98
- **Detail**: The journey's description lists what it asserts ("hydrated islands, the save status, the rating toggles, the cookie session"). It now also asserts the tab the dashboard opens, before and after next week is saved. CLAUDE.md asks for docs to describe the current state in the same PR. The plan didn't list this file, so this is a gap in the plan, not drift.
- **Fix**: Add "the tab the dashboard opens (Next week while unsaved, This week once saved)" to that list in docs/testing.md:98.
- **Decision**: FIXED

### F2 — Seed spec dropped its explicit "Next week" tab visibility check

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/seed.spec.ts:12
- **Detail**: The plan said "same assertions as today, preceded by openTab". `expect(tab "Next week").toBeVisible()` was replaced by `openTab(page, "Next week")`, which clicks the tab and expects `aria-selected="true"`. That is a strictly stronger check, so no coverage is lost.
- **Fix**: None needed; keep as is.
- **Decision**: DISMISSED

### F3 — Playwright reuses whatever already listens on E2E_PORT, even a stale preview

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: playwright.config.ts:49
- **Detail**: Locally `reuseExistingServer` is true. During the Phase 2 gate, a preview left on 4325 from the Phase 1 manual check answered 500 for every `/_astro/*` script after `dist/` was rebuilt. `auth.setup` then failed twice on hydration, which looked like a flake. Stopping the old preview fixed it. The code is fine (CI starts fresh); the risk is an agent misreading the failure.
- **Fix**: Record a lesson: stop any preview on E2E_PORT before `npm run test:e2e` (or after a manual check), and read a hydration timeout in `auth.setup` as a sign of a stale reused server.
- **Decision**: ACCEPTED-AS-RULE: Stop stale previews before running e2e locally (config unchanged: reuse only bites when a preview outlives a rebuild)
