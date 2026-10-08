<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rate Recent Meals

- **Plan**: context/changes/rate-recent-meals/plan.md
- **Scope**: Phase 3 of 4
- **Reviewed phases**: 3
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Keyboard focus is lost on every rating tap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/components/plan/MealRating.tsx:40
- **Detail**: Buttons get `disabled` while `pending`. The browser blurs a focused button when it becomes disabled, so a keyboard or screen-reader user drops to `<body>` after each rating and must tab back through the page. `UpcomingWeekEditor`'s `<fieldset disabled>` has the same behaviour, but here it repeats for every meal of the week.
- **Fix**: During `pending`, use `aria-disabled` and keep the button focusable (the hook's `inFlight` ref already blocks a second tap); keep real `disabled` only for `locked`.
- **Decision**: FIXED — aria-disabled while saving, disabled only when locked

### F2 — Every rating group has the same accessible name

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/components/plan/MealRating.tsx:25-29
- **Detail**: Each group is named by its visible "How was it?", so a screen-reader user moving between groups on "This week" (up to ~14 meals in the window) can't tell which meal a group belongs to.
- **Fix**: Pass the meal name to `MealRating` and add it to the group's name with a visually hidden span (e.g. "How was it?" + sr-only " — Chicken curry").
- **Decision**: FIXED — mealName prop, sr-only in the group label

### F3 — Upcoming plan read embeds ratings it never uses

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/plans.ts:6-9
- **Detail**: `PLAN_SELECT` is shared, so `getUpcomingPlan` also embeds `meal_ratings`. Future meals can't be rated, so the embed is always null; the editor's mapped props never carry it. A cheap PK join under RLS, and consistent with the plan's single `PLAN_SELECT` contract.
- **Fix**: Leave as is (the plan specified one shared select); revisit only if the upcoming read gets hot.
- **Decision**: SKIPPED

### F4 — Read-only rating line has no visible "Your rating" label

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plan/MealSlot.astro:53-59
- **Detail**: Sighted users see only "😋 Chef's kiss" ("Your rating:" is sr-only, as the plan specified). The line is inline markup, while the sibling recency note is its own `RecencyNote.astro`.
- **Fix**: Optional — extract a `RatingNote.astro` mirroring `RecencyNote.astro`; keep the wording as planned.
- **Decision**: FIXED — extracted RatingNote.astro

### F5 — Error copy differs slightly from the plan editor's

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/hooks/useMealRating.ts:4-6
- **Detail**: "Couldn't save your rating." lacks the "Please try again." the plan editor's failure message carries; the 401 message is longer than the plan's "signed out" (it mirrors `usePlanChoices`, which is fine).
- **Fix**: Append " Please try again." to the failure message for parity.
- **Decision**: FIXED — "Please try again." appended
