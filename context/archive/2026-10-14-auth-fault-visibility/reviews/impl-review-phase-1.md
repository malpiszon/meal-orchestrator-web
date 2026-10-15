<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Auth Fault Visibility

- **Plan**: context/changes/auth-fault-visibility/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria at review time:

- `npm test`: 339/339 passed.
- `npm run lint`: 0 errors, 4 `no-console` warnings, following the existing pattern.
- `npm run build`: passed.
- `npm run smoke`: not re-run. It passed (104 steps on :4322) just before commit `eca3a17` on the same code.

All planned items are present (MATCH). The tests cover every case the plan lists and build real `@supabase/supabase-js` error instances.

## Findings

### F1 — Refresh-race errors classed as session faults

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts:4-13, :41-47
- **Detail**: `getUser()` can return two normal session-race outcomes, and the classifier counts both as system faults. Each is then reported as `auth.session`, and the user is sent to `?error=session_unavailable` instead of plain `/auth/signin`.
  - `AuthRefreshDiscardedError` has status 409 and no code (`auth-js/lib/errors.js:245`). `GoTrueClient.js:4256,4279` returns it when a refresh races a sign-out, and auth-js itself treats it as a no-op (`GoTrueClient.js:3672`). Because it has no code and isn't a missing session, the classifier calls it a fault.
  - GoTrue's 409 `conflict` code (listed in `ErrorCode`) can come back when concurrent refreshes collide, for example a page load plus island fetches carrying an expired token. It isn't in `SESSION_QUIET_CODES`.
  - Both are rare with one SSR client per request.
- **Fix**: Add `conflict` to `SESSION_QUIET_CODES`. Treat `isAuthRefreshDiscardedError` as quiet next to `isAuthSessionMissingError` in `isAuthSystemFault`. Add a test case for each.
- **Decision**: FIXED (`conflict` added to SESSION_QUIET_CODES; AuthRefreshDiscardedError quiet in isAuthSystemFault; test added, break-check red)

### F2 — Two classifier precedence choices not pinned by tests

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/auth-errors.ts:43-44
- **Detail**: Two behaviours go beyond the plan's literal wording, and neither has a test.
  - `status === undefined` counts as a fault. The plan says "status 0 or ≥ 500". Today this only affects `AuthUnknownError` and a bare `AuthError`, which have no code and are faults anyway.
  - A 429 with no code is a rate limit (quiet), not a "no code" fault. This follows the plan's intent: rate limits get no Sentry event.
- **Fix**: Add two `isAuthSystemFault` tests: a 429 with no code is not a fault, and an `AuthError` with no status is a fault.
- **Decision**: FIXED (two pinning tests in auth-errors.test.ts: 429 with no code is quiet; AuthError with no status is a fault; both break-checked red)

### F3 — Outage reporting volume: one event per request with a session cookie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:19-27
- **Detail**: `readSessionUser` runs on every request except MO's machine routes. During an Auth outage, every request that carries a session cookie reports once. A protected page reports twice: once on the page, then again on `/auth/signin`, because the cookies survive a retryable failure. Sentry groups these into one issue per code, and the plan accepts no throttling here. The only cost is event quota.
- **Fix**: No code change. In Phase 3's `docs/deployment.md` § Known risks, record the event volume next to the 30 s refresh risk.
- **Decision**: FIXED (queued for Phase 3 docs in follow-ups/review-fixes.md)

### F4 — Sign-in rate-limit mapping narrower than isAuthRateLimit (Phase 2 note)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/signin-errors.ts:23-30
- **Detail**: `signInErrorCode` maps only `over_request_rate_limit` to `rate_limited`, while the new `isAuthRateLimit` accepts any 429 or `*_rate_limit` code. In Phase 2, sign-in will log a 429 with another code as rate limited but show "Couldn't sign you in". The plan keeps the redirect codes unchanged on purpose.
- **Fix**: In Phase 2, leave this as is (the plan says so) or route `signInErrorCode`'s rate-limit check through `isAuthRateLimit`. Decide when Phase 2 starts.
- **Decision**: FIXED (queued for Phase 2 in follow-ups/review-fixes.md: signInErrorCode uses isAuthRateLimit)
