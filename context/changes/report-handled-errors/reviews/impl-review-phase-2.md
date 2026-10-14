<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Handled-Error Reporting Implementation Plan

- **Plan**: context/changes/report-handled-errors/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

All four planned changes match (commit 1f2ed8a). `logStorageError` remains only for the S-10 invitation/provisioning steps; no later frontmatter line can override the 503; `isPasswordUserError` agrees with `passwordErrorMessage`. Privacy: plain-object PostgREST causes are never serialised (linked errors follow `Error` causes only; ExtraErrorData is off), request bodies are off, and `captureException` without a client or DSN doesn't throw. Automated criteria re-run: set-password tests 48/48, bare-`console.error` grep prints nothing, `npm test` 257/257, `npm run lint` 0 errors (3 known `no-console` warnings); build and smoke (104 steps, on 4322) passed during implementation at the same tree. Phase 2 has no manual criteria. The `docs/api.md:115` log-prefix drift is scheduled for Phase 3 and not counted here.

## Findings

### F1 — Delivery wrapper message leaves out the error code

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/mo/deliveries.ts:158
- **Detail**: The wrapper reads `ingest_weekly_plan failed: ${message}`, while the services write `… failed: ${code} ${message}`. Since the PostgREST cause is a plain object and not linked, the Sentry issue title is the only place the event shows the message, and for deliveries it lacks the code (it is still in the fingerprint, the `error_code` tag and the log line).
- **Fix**: Use `ingest_weekly_plan failed: ${result.error.code} ${result.error.message}`, matching the services.
- **Decision**: FIXED (wrapper message now `ingest_weekly_plan failed: <code> <message>`)

### F2 — Lost-session `updateUser` errors count as system faults

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/set-password.ts:82
- **Detail**: `session_not_found`, `session_expired`, `bad_jwt` and `AuthSessionMissingError` (no code, tagged `http_400`) are reported as `auth.set_password.update_user`. They only occur if the session is lost between `verifyOtp` and `updateUser`, which is arguably a fault worth seeing. `reauthentication_needed` can't happen while `secure_password_change = false` (supabase/config.toml:211). All password-policy rejections arrive as `weak_password`/`same_password`, and rate limits as 429, so they are covered.
- **Fix**: None now; if hosted "Secure password change" is ever enabled, add `reauthentication_needed` to `MESSAGES_BY_CODE`.
- **Decision**: ACCEPTED (reporting a lost session is wanted; revisit only if Secure password change is enabled)

### F3 — 503 gains a second meaning in the post-deploy smoke note

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: docs/testing.md:137
- **Detail**: "There, 503 means the Worker secrets are missing" refers to the MO route and stays correct, but the dashboard and history pages now also answer 503 on a plan-load fault.
- **Fix**: In Phase 3, add that the pages' 503 means a database fault, not missing secrets (docs/api.md already gets the 503 line).
- **Decision**: DEFERRED to Phase 3 (follow-ups/review-fixes.md)
