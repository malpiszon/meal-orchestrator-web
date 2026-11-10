<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Retry PGRST303 "JWT issued at future" on MO delivery

- **Plan**: context/changes/sentry-jwt-future/plan.md
- **Scope**: Phase 1 of 2
- **Reviewed phases**: 1
- **Date**: 2026-11-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: commit 9694f72 changes only the two planned src files. Every planned item is a MATCH, and none of the "What We're NOT Doing" items were touched (postgrest-retry.ts, auth-links.ts, mo-delivery-faults.ts and the GoTrue calls are unchanged). Gates were rerun for this review: `npm test` 427/427, `npm run lint` 0 errors (2 warnings already in report-handled-error.ts), `npm run build` exit 0 on Node 24.13.1. The break-check during implementation turned the new tests red. Manual 1.4 was checked against the committed file: the wrapper is at mo-deliveries.ts:115, the two `ingest()` calls at :117 and :155, the new branch at :158, and `isAuthRejection` at :170.

## Findings

### F1 — Worst-case delivery latency closer to MO's 10 s timeout

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/mo-deliveries.ts:115,155
- **Detail**: Each `ingest()` call can now wait up to 2 s on retries, so a request that provisions a new user and then fails both retry rounds waits about 4 s. The GoTrue invite and update calls come on top of that. MO's client timeout is 10 s (docs/mo-delivery-contract.md:104,109). A timeout is still safe, because MO retries it and a re-send is a no-op, but MO would see a timeout rather than a 500.
- **Fix**: In Phase 2, add one line to docs/deployment.md known risks noting the extra latency of up to about 4 s.
- **Decision**: FIXED (queued for Phase 2 in follow-ups/review-fixes.md)

### F2 — runRetries comment misdescribes vi.waitFor

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/mo-deliveries.test.ts:226-230
- **Detail**: The comment says the clock "can only move after the retry warning". With fake timers on, `vi.waitFor` also moves the fake clock forward 50 ms on every poll. That does no harm here, since no retry timer is pending before the warning, and the test is deterministic. The comment is still inaccurate.
- **Fix**: Reword it to say that waitFor also nudges the fake clock, which is harmless because no retry timer is pending before the warning.
- **Decision**: FIXED (runRetries JSDoc reworded)

### F3 — No test for PGRST303 persisting on the post-provisioning ingest

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/mo-deliveries.test.ts:224-270
- **Detail**: The plan didn't require this case. The second `ingest()` uses the same wrapped closure, so the risk is low, but no test covers the sequence P0002 → provisioning → PGRST303 ×3 → 500.
- **Fix**: Optionally add one case answering P0002 and then PGRST303 ×3, asserting 500 storage_failed and 4 RPC calls.
- **Decision**: FIXED (added post-provisioning PGRST303 test; break-check red when the second ingest is unwrapped)

### F4 — `npm run build` gate only passes on Node ≥ 22.23.4

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: .nvmrc
- **Detail**: Astro now requires Node >=22.23.4, but `.nvmrc` and the local install are 22.23.3. `npm run build`, `astro check` and the end-of-turn hook fail locally on 22.23.3. This comes from the environment, not this change: CI uses the latest Node 22, and the build passes on Node 24.
- **Fix**: In a separate change, bump `.nvmrc` and the README's Node version to 22.23.4 or newer, and install that version locally.
- **Decision**: FIXED (queued as a separate change in follow-ups/review-fixes.md)
