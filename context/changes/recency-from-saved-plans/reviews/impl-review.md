<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recency notes from saved plans only

- **Plan**: context/changes/recency-from-saved-plans/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-07
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

Evidence: commits c02ef72, 9e3d9d0, 0026f4e. Phase 1 changes only the `hp.saved_at is not null` predicate (same signature, invoker, search_path, grants). Phase 2 smoke passed against the preview on :4322 with local Supabase (all steps, including "no recency notes while no earlier plan is saved" and "later week shows recency notes from the saved week, none for the swapped-away meal"). Lint, astro check, build, `supabase test db` and `npm test` pass. Manual 1.5, 2.3, 2.4 were run on the local stack and confirmed by the user. Extra: README step 6 was added (not named in the plan, needed because step 4 no longer shows a note); "What We're NOT Doing" is respected (no dashboard hint, no backfill, no changes to choose/confirm/ingest).

## Findings

### F1 — Started-week pgTAP fixture duplicates the unsaved one

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/get_plan_recency.test.sql (plan 5)
- **Detail**: The function never looks at the history week's date, so the "started, never saved" plan exercises the same predicate as plan 4.
- **Fix**: None needed; keep as documentation of the plan's required case.
- **Decision**: FIXED — removed the redundant plan 5 / meal T fixtures; the test comment notes a started week is covered by the saved_at rule (pgTAP passes)

### F2 — Smoke positive note check is panel-wide

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs (step "later week shows recency notes from the saved week…")
- **Detail**: The positive assertion is `nextWeek.includes(recencyNote)`: any one note in the panel satisfies it, not a specific meal's. The negative check on the swapped-away option label is specific, so the regression to "recommended counts" is still caught.
- **Fix**: Optionally assert the note on the label of the meal the user chose in the saved week.
- **Decision**: FIXED — positive assertion now checks the note on the saved-week swap option's label (smoke re-run passed)

### F3 — README smoke paragraph: stacked "and that" clauses

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: README.md, "Smoke test" section (delivery steps paragraph)
- **Detail**: The paragraph's final clauses read "…; and that a re-delivery … ; and that a delivery of a week 7 days after…", with two "and"s in the list.
- **Fix**: Drop the earlier "and" so only the last clause carries it.
- **Decision**: FIXED — removed the extra "and" in the README smoke paragraph
