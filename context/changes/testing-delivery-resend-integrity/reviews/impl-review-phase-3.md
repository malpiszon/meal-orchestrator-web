<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Delivery and Re-send Integrity (S-02)

- **Plan**: context/changes/testing-delivery-resend-integrity/plan.md
- **Scope**: Phase 3 of 4
- **Reviewed phases**: 3
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

Reviewed: phase commit c1c2e99 (fixture, smoke round trip, schema test) and, for cross-phase effects, merge 944d8fa (master's #176 route changes ported into the Phase 2 handler, new 503 key-rejection unit cases, contract table merged with Phase 1's wording). The ported handler differs from master's route only by dependency injection. `npm test` (424 passed) and `npm run lint` (0 errors) re-run for this review; CI `smoke`, `ci` and `e2e` green on 944d8fa (PR #184).

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Unknown keys inside justifications are not covered

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/smoke.mjs:215 (`expectedOptions`), scripts/fixtures/mo-delivery.edge-cases.json
- **Detail**: `expectedOptions` copies `justifications` verbatim, while zod strips unknown keys inside justification objects before they reach the `justifications` column. The fixture has no justification with an extra key, so the round trip doesn't pin that rule, and if one were added the expectation would be wrong. The contract's "unknown nested keys" wording doesn't name justifications explicitly. Unknown-key coverage of stored columns is otherwise only via `nutrition` (`energy_kcal`).
- **Fix**: Add an unknown key to one justification in the fixture and drop unknown keys from justifications in `expectedOptions` (if the contract's nested-key rule covers them; otherwise clarify the contract first).
- **Decision**: FIXED (Fix A) — contract's unknown-nested-keys list now names justifications; e200's first justification carries `weight: 2`; `expectedOptions` keeps only `{icon, text}`. Round trip green locally; break-check (verbatim copy) went red on `justifications.0.weight`.

### F2 — Two more password-grant sign-ins per smoke run

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:~1355, ~1377
- **Detail**: The round trip signs in twice with the password grant on top of the existing ~6 sign-ins. `supabase/config.toml` sets `sign_in_sign_ups = 30` per 5 minutes per IP; not verified whether local GoTrue enforces it. Several smoke reruns within 5 minutes on the shared stack could approach it.
- **Fix**: None now; if a password-grant 429 appears, read it as this limit before debugging the test.
- **Decision**: SKIPPED

### F3 — Smoke criterion 3.2 verified in CI, not locally

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 3.2
- **Detail**: `astro preview` would not start on the local machine; smoke against `wrangler dev` passed all 8 round-trip steps but failed 3 pre-existing steps (wrangler's local proxy drops the next request after a 401 that doesn't read the body; HEAD's smoke failed identically). 3.2 was ticked on CI's green `smoke` job on 944d8fa, which runs `astro preview`.
- **Fix**: None needed; recorded so the tick's evidence is clear.
- **Decision**: ACCEPTED — CI's green `smoke` job on 944d8fa is the evidence for 3.2.
