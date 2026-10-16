<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Collapse Fully Rated Days

- **Plan**: context/changes/collapse-fully-rated-days/plan.md
- **Scope**: Phase 1 of 2
- **Reviewed phases**: 1
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: every planned file changed as described (`isDayFullyRated` with the 5 specified cases, the opt-in `collapseRatedDays` prop defaulting to off, the dashboard passing it, `/history/[id].astro` untouched, the `docs/api.md` row and § Ratings bullet). Nothing from "What We're NOT Doing" was touched: no island, no client JS, no `MealRating`/API/DB change, no edit to `critical-journey.spec.ts`. The only change outside the plan is the S-13 roadmap status flip. Styling uses tokens only, and `className` on `Card` carries layout classes only. The focus ring copies shadcn button's `focus-visible:ring-ring/50 ring-[3px]`. Automated checks re-run at e04d177: `npm test` 380 passed, `npm run lint` 0 errors, `astro check` 0 errors. Build and smoke passed on identical source before the commit (the smoke's first run hit environmental failures on the shared stack; a clean rerun passed). Manual rows 1.5–1.10 were confirmed by the user, with 1.9 checked against a seeded past week.

## Findings

### F1 — Heading inside `<summary>` not yet proven exposed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/components/plan/WeekPlan.astro:58
- **Detail**: The collapsed day's `<h3>` sits inside `<summary>`, which browsers expose as an interactive disclosure control. Whether Chromium still exposes the `<h3>` as a heading is unverified. If it doesn't, heading navigation loses fully rated days, and the e2e `dayCard` helper (`getByRole("heading")` inside `[data-slot="card"]`) can't find a collapsed day. The plan already makes this a Phase 2 assertion and names the fallback (an accessible name that starts with the weekday).
- **Fix**: Assert it in Phase 2's `rated-days.spec.ts` as planned; apply the plan's fallback only if the assertion fails.
  - Strength: Settles it with a real browser, where the answer is defined.
  - Tradeoff: Phase 1 ships the markup before the question is answered.
  - Confidence: MED — browsers differ on children of interactive roles.
  - Blind spot: Screen readers other than what Playwright's accessibility tree reflects.
- **Decision**: QUEUED — assert in Phase 2 `rated-days.spec.ts` (see follow-ups/review-fixes.md)

### F2 — Day content markup duplicated in both branches

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plan/WeekPlan.astro:79-83, 92-96
- **Detail**: The `day.slots.map(... <MealSlot .../>)` list appears twice, once in each branch. A future change to how a day's meals render must be made in both places.
- **Fix**: Leave as is. In Astro a shared fragment would need a new sub-component for 4 lines; revisit if the list grows.
- **Decision**: SKIPPED
