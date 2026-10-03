<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Email-link Callback Implementation Plan

- **Plan**: context/changes/email-link-callback/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: every Phase 2 contract item matches the code in 212f3a0 (`generateLinkToken` + six gated steps in `scripts/smoke.mjs`, `SUPABASE_SERVICE_ROLE_KEY` in the CI smoke step, README paragraph). No files outside the plan changed. Lint clean (0 errors), 26/26 smoke steps pass on the :4322 preview, and the PR #45 `ci` and `smoke` jobs are green with the email-link steps executed. The break-check (ignore `verifyOtp` errors) turned the reused-link and garbage-link steps red. Phase 1's route is unchanged.

## Findings

### F1 — Reused-link step can pass on its own when no token was generated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:355
- **Detail**: If `generate_link` for the recovery link fails, `recoveryTokenHash` is undefined, and "used password-reset link is rejected" opens the link with the token `"missing"`. That passes, so the step proves nothing. The run still fails overall, because the preceding "password-reset link signs the smoke user in" step returns the Admin API failure, so nothing is hidden today.
- **Fix**: Leave it as is. If wanted, make the step return a failing result when `recoveryTokenHash` is unset.
- **Decision**: FIXED — the reuse step fails when no recovery token was generated (scripts/smoke.mjs)
