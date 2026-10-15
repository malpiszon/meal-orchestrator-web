<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Auth Fault Visibility

- **Plan**: context/changes/auth-fault-visibility/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria: `npm test` (347 passed), `npm run lint` (0 errors), `npm run build`, `npx astro check` and `npm run smoke` on :4322 all passed for commit 8d6796a. `eslint.config.js` (adding `signin.ts` to the Workers Logs list) is outside the plan, but lint needed it and it follows the repo's convention.

## Findings

### F1 — Session fault on the retry path shows "expired" and is reported twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/auth/set-password.ts:84-87, src/pages/auth/set-password.astro:42-45,57-71
- **Detail**: The plan's `auth.set_password.session` row says the user lands "back on `/auth/set-password` (no link) with the same 'try again' message". During an Auth outage, however, the GET's middleware also fails, so `locals.user` is `null`, `isRetry` is false and `showForm` is false. The page then shows "This link is invalid or has expired." with "Ask for a new link", and the `error` parameter is never rendered: only `SetPasswordForm` renders it. There are also duplicate events. The middleware has already reported `auth.session` for the POST, and the route's second `getUser()` reports `auth.set_password.session` for the same outage. The redirected GET then reports `auth.session` again. That makes 3 events in 2 Sentry issues. A related edge case: a 429 from that `getUser()` falls through to `invalid_link` ("expired").
- **Fix A ⭐ Recommended**: On the page, when there's no form and `error` equals `LINK_CHECK_FAILED_MESSAGE`, show the "try again" copy instead of "invalid or has expired" (and keep the "Ask for a new link" fallback). Accept the duplicate events and note them in the plan.
  - Strength: A small, local change that makes the plan's stated user-visible outcome true. A reload after the outage brings the form back, because the session cookies are kept on a retryable refresh failure.
  - Tradeoff: An outage on this rare path still produces an extra `auth.set_password.session` issue next to `auth.session`.
  - Confidence: HIGH — confirmed by reading `set-password.astro`.
  - Blind spot: The page trusts a query-string value to pick its copy. That's harmless, since the copy is fixed text and the comparison is exact.
- **Fix B**: Have the middleware put a session-fault flag on `locals`. The route then reads `locals.user` and the flag instead of calling `getUser()` again, and the page renders "try again" when the flag is set.
  - Strength: One event per request, and no second Auth call during an outage, which also avoids a second refresh retry of up to 30 s.
  - Tradeoff: It goes against the plan's NOT-doing line ("no locals flag for routes"), touches `env.d.ts`, the middleware and the page, and removes the `auth.set_password.session` step from the plan's tables and docs.
  - Confidence: MED — wider change across Phase 1 code.
  - Blind spot: Other routes might start depending on the flag.
- **Decision**: FIXED (Fix A) — `set-password.astro` shows `LINK_CHECK_FAILED_MESSAGE` when there is no form; duplicate events accepted and queued for the Phase 3 docs (`follow-ups/review-fixes.md`)

### F2 — reportHandledError's log line doesn't mask emails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-handled-error.ts:72 (reached from src/pages/api/auth/forgot-password.ts:41)
- **Detail**: Some GoTrue errors on the recover and sign-in paths quote the address, for example `email_address_not_authorized`. The Sentry event is masked by `scrubEvent`, but the helper's own `console.error` line prints `message` raw to Workers Logs. This isn't a regression, because the old code logged the same message. It still breaks the plan's privacy rule that the email never reaches a log line, and Phase 2 routes more Auth errors through this helper.
- **Fix**: Use `maskEmails(message)` in the log line (one line, which covers every caller), plus a unit test.
- **Decision**: FIXED — log line and stack masked with `maskEmails`; test added

### F3 — An invalid email on reset becomes an error-level event

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts (`RESET_EMAIL_QUIET_CODES`), src/pages/api/auth/forgot-password.ts:40-42
- **Detail**: `RESET_EMAIL_QUIET_CODES` is empty. An address that passes zod but that GoTrue rejects (`email_address_invalid`) is therefore reported as `auth.forgot_password` at error level. This is user-caused noise. Making it quiet reveals nothing, because the response is always `?sent=1` and GoTrue checks the format before looking up the account.
- **Fix**: Add `email_address_invalid` to `RESET_EMAIL_QUIET_CODES`, plus its test case.
- **Decision**: FIXED — `email_address_invalid` added to `RESET_EMAIL_QUIET_CODES`; forgot-password logs it at info via `isAuthSystemFault`

### F4 — The link-check report lost the link type

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/auth-links.ts:35,46
- **Detail**: The old warn line said `(type invite|recovery)`. The `auth.link_check` report now carries only the step and the code, so a check that fails for only one link type can't be told apart. The type isn't sensitive.
- **Fix**: Leave as is (step and code are enough at warning level), or extend `reportHandledError`'s options to take an explicit hint, which is a wider change. Not worth fixing now.
- **Decision**: SKIPPED

### F5 — Phase 1 review's queued sign-in rate-limit fix wasn't applied

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/signin-errors.ts:21-30
- **Detail**: `follow-ups/review-fixes.md` (F4 from the Phase 1 review) queued this for Phase 2. `signInErrorCode` maps only `over_request_rate_limit` to `rate_limited`, but `signin.ts` now logs any `isAuthRateLimit` error (a 429 or a `*_rate_limit` code) as rate limited. A 429 with another code therefore logs "rate limited" while the page says "Couldn't sign you in".
- **Fix**: `signInErrorCode` returns `rate_limited` when `isAuthRateLimit(error)` (keeping the plain `over_request_rate_limit` case), plus a test with a real 429 `AuthApiError` carrying `over_email_send_rate_limit`.
- **Decision**: FIXED — `signInErrorCode` returns `rate_limited` for any `isAuthRateLimit` error; tests with real 429 `AuthApiError`s
