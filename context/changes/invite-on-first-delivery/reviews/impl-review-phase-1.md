<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Invite on first delivery

- **Plan**: context/changes/invite-on-first-delivery/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-04
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

Automated checks re-run: lint, 111 unit tests, astro check, build all pass. Manual rows 1.5-1.8 were run against local Supabase (invite email, second delivery, SMTP-failure fallback with logged error).

Not findings (already planned or declined): `scripts/smoke.mjs` still expects the old confirm behaviour and will fail until Phase 2; README still describes the old invite flow (Phase 3); no `invited` field in the delivery response (plan "What We're NOT Doing").

## Findings

### F1 — provisioned_by set in a second, non-atomic call

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:112-117
- **Detail**: If `updateUserById` fails after a successful invite, the account lacks `provisioned_by`. Only logged. Nothing reads the field today.
- **Fix**: None needed now; revisit if anything starts reading `provisioned_by`.
- **Decision**: PENDING

### F2 — Concurrent deliveries for one new email may send two invitations

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:111-134
- **Detail**: GoTrue may re-invite an unconfirmed user instead of erroring, invalidating the first token. Unverified; MO delivers sequentially.
- **Fix**: None needed.
- **Decision**: PENDING

### F3 — No unit test for the invite/fallback branches

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/mo/deliveries.ts
- **Detail**: Both branches were verified manually and will be covered by smoke after Phase 2. The plan defers extra tests to the user.
- **Fix**: None; covered by the user's planned test strengthening.
- **Decision**: PENDING
