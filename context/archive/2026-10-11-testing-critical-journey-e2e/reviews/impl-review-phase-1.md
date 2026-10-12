<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Critical-journey e2e as a CI gate (S-04)

- **Plan**: context/changes/testing-critical-journey-e2e/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Setup's fixed run_id contradicts the plan's "unique run_id per call"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/auth.setup.ts:18, tests/e2e/support/deliveries.ts:52
- **Detail**: Plan Phase 1 §1 says each `deliverWeek` call gets a unique `run_id`; §4 says a same-day re-run sends an identical (no-op) delivery. The two conflict: `docs/mo-delivery-contract.md` and `docs/api.md:48` count `run_id` in "identical". The implementation adds an optional `runId` (unique by default) and setup passes `e2e-setup-<weekStart>`. Sound choice, but the plan still states the old contract, so later reviews of Phase 2/3 would read it as drift.
- **Fix**: Add a short addendum under Phase 1 (or Key Discoveries) recording the optional `runId` and why setup fixes it per week.
- **Decision**: FIXED — addendum under Phase 1 §4 in plan.md

### F2 — Admin user lookup pages without an upper bound

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/support/users.ts:35
- **Detail**: `findUser` loops `for (page = 1; ; page++)` and stops only when a page has fewer than 100 users. If a GoTrue version ignored `page` (returning the same full page each time), setup would hang until Playwright's test timeout instead of failing with a clear message. Unlikely with the email filter (results are tiny), so observation only.
- **Fix**: Cap the loop (e.g. 20 pages) and throw a message naming the email when the cap is hit.
- **Decision**: FIXED — loop capped at MAX_PAGES = 20, throws naming the email
