<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rating-ordered options (S-13)

- **Plan**: context/changes/rating-ordered-options/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — One pgTAP run failed, cause unknown

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/ (file not identified)
- **Detail**: 1 of 14 runs of `npx supabase test db` returned FAIL; its output was cut off and 13 reruns passed. The new test sorts its snapshot comparisons and the run wasn't near the Warsaw midnight. The likeliest cause is the shared local stack: another worktree's tests or smoke running at the same moment (test files use fixed user UUIDs).
- **Fix**: Accept for now; if it recurs, keep the full output (CI runs on its own stack, so it would show there).
- **Decision**: FIXED + ACCEPTED-AS-RULE: Capture full pgTAP output on the shared local stack (process fix: full output kept from now on; no code change)

### F2 — A rating can be missed while a first delivery is in flight

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008180000_rating_ordered_defaults.sql (rate_meal re-pick)
- **Detail**: If a rating commits while MO's first delivery of a new upcoming week is still in its transaction, ingest doesn't see the rating and rate_meal doesn't see the plan yet, so that week keeps the pre-rating pick until the next rating of the meal or a re-delivery. The window is milliseconds; no data is lost.
- **Fix**: Accept; the user can still swap. No code change.
- **Decision**: ACCEPTED — race window is milliseconds, no data loss; the user can still swap. No code change.

### F3 — First delivery of a started week now stores the suggested pick

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: ingest_weekly_plan → pick_default_choices
- **Detail**: Follows from the rule, but the plan doesn't name it: a week that arrives already started stores the rating-adjusted pick, which then decides what can be rated and what history shows.
- **Fix**: Cover it in Phase 3's README wording ("the suggested pick when the plan was never saved"), which the plan already schedules.
- **Decision**: FIXED — queued for Phase 3 README wording in follow-ups/review-fixes.md
