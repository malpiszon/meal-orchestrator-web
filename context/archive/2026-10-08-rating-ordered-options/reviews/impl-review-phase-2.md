<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rating-ordered options (S-13)

- **Plan**: context/changes/rating-ordered-options/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Phase 2's automated criteria were re-run for this review: `npm test` (144 tests), `npm run lint`, `npx astro check` (0 errors) and `npm run build` all pass. The user confirmed manual rows 2.5 and 2.6 on :4323 after the backfill.

## Findings

### F1 — The backfill migration isn't recorded in the plan, and the documents still say the opposite

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20261009090000_repick_unsaved_upcoming_plans.sql
- **Detail**: The migration was added during manual testing, at the user's request. Several documents still say existing plans are not re-picked:
  - plan.md "Migration Notes" says "Existing stored plans are not re-picked by the migration".
  - plan-brief.md lists that re-pick as out of scope.
  - The header of 20261008180000 says "Existing plans are not re-picked by this migration."
  - Phase 3's README task lists only `rating_ordered_defaults` for the production push.

  pgTAP can't cover the migration, because CI builds the database from empty migrations, so the DO block does nothing there.
- **Fix**: Add a dated addendum to plan.md recording the decision, and correct the Migration Notes and the Phase 3 README task. Phase 3's README must list `repick_unsaved_upcoming_plans` for the push-before-merge.
- **Decision**: FIXED — plan.md addendum, Migration Notes and Phase 3 README task updated

### F2 — The smoke test fails on the renamed history status until Phase 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:450-452, 726
- **Detail**: `showsNotSavedLabel` only accepts "Not saved: MO's recommendation", so the "history week page shows its meal" step now fails. Phase 3 schedules this fix. The steps that use `recommendedIndex` keep passing only while the smoke user hasn't rated those meals.
- **Fix**: Don't push this branch before Phase 3. In Phase 3, update line 451 and re-check every `recommendedIndex` step after the 5/5 rating.
- **Decision**: FIXED (deferred) — handled in Phase 3; branch not pushed before then

### F3 — An unused `is_recommended` field is still sent to the editor

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plan/UpcomingWeekEditor.tsx:22, src/pages/dashboard.astro:80
- **Detail**: `EditorOption` still picks `is_recommended`, and the dashboard still maps it. Nothing in the editor reads it any more, so it is serialized into every option for nothing.
- **Fix**: Drop `is_recommended` from the `EditorOption` Pick and from the dashboard mapping.
- **Decision**: FIXED — field dropped from the EditorOption Pick and the dashboard mapping

### F4 — If ratings fail to load, the selected option may not be the first or starred one

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:83-84
- **Detail**: Without ratings, the page sorts and stars by MO's score, but the selection is still the stored, rating-adjusted `is_chosen`. The page still renders and logs the error, and "Keep these picks" saves what is shown as selected. The plan's contract asks for this fallback.
- **Fix**: Accept it as intended degradation.
- **Decision**: ACCEPTED — intended fallback per the plan

### F5 — Between `db push` and the deploy, the old Worker shows re-picked selections

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: production rollout (both S-13 migrations)
- **Detail**: After the push, stored unsaved picks are rating-adjusted while the old Worker still orders and stars by MO's score. For a few minutes, a user with 1/5 or 5/5 ratings can see a selected option that isn't first. Nothing is corrupted.
- **Fix**: Mention the window in the README production note in Phase 3.
- **Decision**: ACCEPTED — window to be noted in the Phase 3 README production note

### F6 — A first delivery racing a rating of the same meal may keep a stale pick (Phase 1)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008180000_rating_ordered_defaults.sql (ingest_weekly_plan / rate_meal)
- **Detail**: Under READ COMMITTED, a first delivery of a plan may not see a rating that is committing at the same moment, and `rate_meal` may not see the new plan. That plan keeps a stale pick until the next rating or re-delivery. The window is milliseconds wide.
- **Fix**: Accept it; the next rating or re-delivery heals it.
- **Decision**: ACCEPTED — heals on the next rating or re-delivery
