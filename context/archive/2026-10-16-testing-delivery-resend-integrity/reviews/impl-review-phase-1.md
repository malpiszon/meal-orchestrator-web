<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Delivery and Re-send Integrity (S-02)

- **Plan**: context/changes/testing-delivery-resend-integrity/plan.md
- **Scope**: Phase 1 of 4
- **Reviewed phases**: 1
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria re-run at review: `npx supabase test db` PASS (10 files, 259 tests), `npm run lint` 0 errors (2 pre-existing warnings), `npx prettier --check docs context/foundation/prd.md` PASS. Manual 1.4 has evidence (verified against `docs/api.md` Re-delivery and `ingest_weekly_plan` / `pick_default_choices`).

## Findings

### F1 — FR-018's 2026-10-06 note still says "MO's new recommendation"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/prd.md:198
- **Detail**: The phase's goal is a correct oracle. FR-017's new 2026-10-16 note says a slot whose dish is gone gets the rating-adjusted suggested pick, but FR-018's own note still says "otherwise MO's new recommendation is chosen", so the PRD contradicts itself under the requirement it is about.
- **Fix**: Append a dated note under FR-018: "> Update (2026-10-16): where the kept dish is gone, the slot gets mo-web's suggested pick (MO's score adjusted by the user's ratings, FR-013), not MO's recommendation; see FR-017." The existing note stays as history.
- **Decision**: FIXED

### F2 — Atomicity snapshots can't fail independently of throws_ok

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/delivery_atomicity.test.sql:1-12
- **Detail**: `ingest_weekly_plan` is one statement; `throws_ok` runs it in a subtransaction rolled back on error, so the plan/option/choice comparisons can only go red if the function swallowed its error and returned, which `throws_ok` already catches. The real protection is "the error is raised, not caught" (plus the route mapping it to 500). Harmless, but the header could over-sell the coverage.
- **Fix**: Add one header sentence: the snapshot checks pin that the function has no handler that swallows the insert error; rollback itself is Postgres's guarantee.
- **Decision**: FIXED

### F3 — Header prefix differs from sibling M-2 test files

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/delivery_atomicity.test.sql:1; supabase/tests/week_resubmission.test.sql:1-5
- **Detail**: Siblings start `-- S-NN (change-id): pins …` (e.g. date_boundaries.test.sql); the new file starts `-- Test-plan risk #2 (…)`. week_resubmission's header doesn't mention the new dropped-day/slot and week_end/provider cases.
- **Fix**: Start the new header with `-- S-02 (testing-delivery-resend-integrity): pins …` (keep the risk #2 reference) and add a clause for the two new re-send cases to week_resubmission's header.
- **Decision**: FIXED

### F4 — Contract 500 row doesn't state what the atomicity test proves

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: docs/mo-delivery-contract.md:124
- **Detail**: The 409 row says "the user's week stays as it was"; the 500 `storage_failed` row says only "couldn't store the week", though a failed store now provably leaves the previously stored week unchanged — the guarantee MO's retry policy relies on.
- **Fix**: Add "; a week stored earlier stays as it was" to the 500 row's meaning.
- **Decision**: FIXED
