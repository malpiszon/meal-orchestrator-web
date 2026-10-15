# Auth Fault Visibility Implementation Plan

## Overview

When Supabase Auth fails, mo-web currently makes it look like something normal: everyone signing out, every invitation expiring or a wrong password. The same goes for a missing Supabase secret. This change reports those system faults to Sentry through the S-08 helper `reportHandledError` and shows "try again" where that applies. Anonymous visits, dead links, wrong passwords and rate limits stay out of Sentry. It is roadmap S-09 (#144) and covers the audit findings X1, X4, A1–A4 and A8.

## Current State Analysis

- **X1, the session check:** `src/middleware.ts:21-24` reads `data.user` from `getUser()` and ignores `error`. An Auth outage sends every protected page to `/auth/signin` with no log. The JSON routes, which read `locals.user`, answer 401.
- **A1, link verification:** `src/pages/api/auth/set-password.ts:63-67` sends any `verifyOtp` error to `/auth/forgot-password?error=invalid_link`, which says "link expired, ask for a new one".
- **A3, the retry path:** on the no-token path, `set-password.ts:71-76` ignores the `getUser()` error.
- **A4, sign-in:** `src/pages/api/auth/signin.ts:30-33` logs every error at `console.error`, wrong passwords included. Unknown errors become `sign_in_failed` with no report.
- **A2, password reset:** `src/pages/api/auth/forgot-password.ts:34-36` logs any `resetPasswordForEmail` error and answers `?sent=1`. The success copy is deliberate: it avoids revealing which accounts exist.
- **A8, the link check:** `src/lib/services/auth-links.ts:30-45` writes `console.warn` on an RPC error, timeout or throw, and fails open.
- **X4, missing secrets:** `src/lib/supabase.ts:7-9,32-34,46-48` returns `null` with no log when a secret is missing. All four secrets are `optional: true` (`astro.config.mjs:48-51`).
- **Already in place from S-08:**
  - `reportHandledError(step, error, { level, code })` (`src/lib/report-handled-error.ts:59`): one log line plus one event, fingerprinted `["handled", step, code]`. The code is the cause chain's `code`, else `http_<status>`, else `unknown`.
  - set-password's `updateUser` already reports as `auth.set_password.update_user` (A6).
  - The user-vs-fault predicate pattern, `isPasswordUserError` (`src/lib/set-password.ts:125`).

## Desired End State

**Reported**, each as one log line plus one Sentry event grouped by step and code:

| Step                           | When                                                                                                                                                      | Level   | User sees                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.session`                 | the middleware's `getUser()` hits a system fault                                                                                                          | error   | a protected page sends the user to `/auth/signin?error=session_unavailable`: "We couldn't check your sign-in. Try again in a moment." |
| `auth.set_password.verify_otp` | `verifyOtp` hits a system fault                                                                                                                           | error   | back on `/auth/set-password` with the same link and "Couldn't check your link. Try again in a moment."                                |
| `auth.set_password.session`    | the no-token retry path's `getUser()` hits a system fault                                                                                                 | error   | back on `/auth/set-password` (no link) with the same "try again" message                                                              |
| `auth.signin`                  | `signInWithPassword` hits a system fault                                                                                                                  | error   | `/auth/signin?error=sign_in_failed` (unchanged copy: "Couldn't sign you in. Try again in a moment.")                                  |
| `auth.forgot_password`         | `resetPasswordForEmail` hits a system fault                                                                                                               | error   | unchanged `?sent=1` (no account enumeration)                                                                                          |
| `auth.link_check`              | the `auth_link_is_valid` RPC errors, times out or throws                                                                                                  | warning | unchanged: the form shows (fails open)                                                                                                |
| `supabase.config`              | a Supabase client factory finds `SUPABASE_URL`, `SUPABASE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` missing; once per secret per isolate, code `missing_<NAME>` | error   | unchanged (`not_configured`, 503, sign-in redirect)                                                                                   |

**Not reported:**

| Case                                              | What happens instead                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Anonymous visit, or an expired or revoked session | no log                                                                                    |
| Dead link (`otp_expired`)                         | `console.info` and `invalid_link` as today                                                |
| Wrong password or another user-side sign-in code  | `console.info`, no longer `console.error`                                                 |
| Any Auth rate limit (429)                         | `console.warn` with a stable `auth <site>: rate limited` prefix; existing rate-limit copy |

The docs describe the new steps and notices.

**A system fault** is an Auth error with any of these:

- status 0 or ≥ 500 (`AuthRetryableFetchError` covers network failures and 500–504 and 520–530);
- a non-JSON response (`AuthUnknownError`);
- no `code` (except `AuthSessionMissingError`);
- a `code` that isn't on the call site's quiet list and isn't a rate limit.

A non-`AuthError` value also counts.

Verify with unit tests for the classifier, the session helper and the secrets reporter. Then run one manual probe: a preview build sends to a local listener, and a throwaway proxy in front of local Supabase answers 503 on chosen paths.

### Key Discoveries:

- A 5xx from GoTrue reaches the client with **no `code`**. `handleError` turns 500–504 and 520–530 into `AuthRetryableFetchError(status)` and a thrown fetch into status 0 (`node_modules/@supabase/auth-js/dist/module/lib/fetch.js:22-44`). So outage events group as `http_0` or `http_<status>`, and the message is kept.
- `verifyOtp` with an expired, used or made-up `token_hash` always answers `403 otp_expired` "Email link is invalid or has expired" (probed against local GoTrue v2.197.0, for recovery and invite). It is the only "dead link" code. An unsupported `type` answers `400 validation_failed`, which is our bug, so a fault.
- `getUser()` returns, without a fault:
  - `AuthSessionMissingError` (no cookies, or a session deleted server-side; `session_not_found` is converted at `fetch.js:76-80`);
  - `refresh_token_not_found`, `refresh_token_already_used` or `session_expired` (refresh failed);
  - `bad_jwt`, `user_not_found` or `user_banned`.

  All of these are normal signed-out cases (probed: `bad_jwt`, `user_not_found`, `refresh_token_not_found`).

- On a retryable refresh failure the session cookies are kept (`GoTrueClient.js:4296-4314` removes the session only on a non-retryable error). A reload after the outage therefore signs the user straight back in.
- `resetPasswordForEmail` answers `200 {}` for an unknown email (probed), so reporting its faults reveals nothing about which accounts exist.
- `@supabase/supabase-js` re-exports `isAuthError`, `isAuthRetryableFetchError` and `isAuthSessionMissingError` (`node_modules/@supabase/supabase-js/dist/index.d.mts:7`).
- `setPasswordUrl({ link, error })` (`src/lib/set-password.ts:53`) already rebuilds the form URL with the link kept. The set-password page reruns the link check on that GET, so if GoTrue did use the token before failing, the page shows "invalid or has expired". That is still correct.
- The smoke steps for garbage, used and token-less links expect `/auth/forgot-password?error=invalid_link` (`scripts/smoke.mjs:1305-1360,1491-1501`). Those are `otp_expired` or session-missing cases and must stay unchanged.

## What We're NOT Doing

- **Sign-out (A7):** reading `signOut()`'s error. Also the link check's "not live" reason (A5) and the malformed-form and malformed-link warns (A9, A10).
- **Delivery-route faults (S-10):** invitation and provisioning failures and the delivery route's secret checks. Streamed render errors are S-11.
- **401 answers stay as they are.** JSON routes keep answering 401 during an Auth outage, with no 503 there and no locals flag for routes. Protected pages also don't move to a 503 page.
- **Rate limits get no Sentry event.** They get a warn line only.
- **The middleware's up-to-30 s refresh retry during an outage** (`_refreshAccessToken`) is not shortened.
- **No alert rules, no throttle beyond once per isolate for secrets, and no CI check** that events arrive.
- **Failing the build or boot on a missing secret.** The secrets stay optional, so local dev and the CI build still work.

## Implementation Approach

The quiet-vs-fault decision lives in one tested module, `src/lib/auth-errors.ts`. Each call site keeps its own quiet code list and its own copy, and hands faults to `reportHandledError` unchanged, so the `AuthError` becomes the reported exception and its status and message are kept. The middleware's session read moves into a small helper that a fake client can test. Missing secrets go through a once-per-isolate reporter that names variables only. Phase 3 proves the whole set end to end with a 503-injecting proxy, because route handlers have no unit tests in this repo.

## Critical Implementation Details

- **Privacy:**
  - Never pass the email, password, `token_hash` or the user to the report.
  - Auth error messages can quote input. `scrubEvent` masks emails in exception messages, and `reportHandledError` sends tags only from `code` and `hint`.
  - The secrets reporter must put variable names in the message, never values.
- **Ordering in set-password:** the "try again" redirect for a `verifyOtp` fault must keep the link (`setPasswordUrl({ link: { token_hash, type }, error })`). The retry cookie must not be set on that path, because no token was verified.

## Phase 1: Classifier, session check and secrets

### Overview

Adds the shared fault predicate, makes the middleware read the session error, adds the sign-in notice and reports missing secrets. This phase closes the two highest-volume blind spots (X1, X4).

### Changes Required:

#### 1. Auth fault classifier

**File**: `src/lib/auth-errors.ts` (new), `src/lib/auth-errors.test.ts` (new)

**Intent**: One rule for "is this Auth error a system fault?", so the call sites can't drift. Each site passes the codes that are normal for it.

**Contract**:

- `isAuthRateLimit(error): boolean`: status 429, or a code ending in `_rate_limit`.
- `isAuthSystemFault(error: unknown, quietCodes: ReadonlySet<string>): boolean`. It returns true for:
  - a non-`AuthError`;
  - `AuthRetryableFetchError`;
  - status 0 or ≥ 500;
  - an error with no code, except `AuthSessionMissingError`;
  - a code that is neither in `quietCodes` nor a rate limit.
- Exported quiet lists:
  - `SESSION_QUIET_CODES`: `refresh_token_not_found`, `refresh_token_already_used`, `session_expired`, `session_not_found`, `bad_jwt`, `user_not_found`, `user_banned`, `no_authorization`.
  - `VERIFY_OTP_QUIET_CODES`: `otp_expired`.
  - `SIGN_IN_QUIET_CODES`: `invalid_credentials`, `email_not_confirmed`, `user_banned`.
  - `RESET_EMAIL_QUIET_CODES`: empty.
- Tests:
  - every quiet code is not a fault;
  - `AuthSessionMissingError` is not a fault;
  - 429 with each rate-limit code is not a fault;
  - `AuthRetryableFetchError` with status 0 and 503 is a fault;
  - `AuthUnknownError` is a fault;
  - `validation_failed` at verify is a fault;
  - a plain `Error` and a string are faults.
  - The tests build real error instances from `@supabase/supabase-js`.

#### 2. Session read with fault flag

**File**: `src/lib/auth-session.ts` (new), `src/lib/auth-session.test.ts` (new)

**Intent**: The middleware's `getUser()` keeps treating every failure as anonymous, but a system fault is reported and flagged, and a rate limit is logged at warn.

**Contract**:

- `readSessionUser(supabase: SupabaseClient, step: string): Promise<{ user: User | null; fault: boolean }>`.
- On error:
  - a quiet error returns `{ user: null, fault: false }` with no log;
  - a rate limit gives `console.warn("auth session: rate limited (<code|status>)")` and `fault: false`;
  - a fault calls `reportHandledError(step, error)` and returns `fault: true`.
- A thrown exception from the client counts as a fault too.
- Tests use a fake `{ auth: { getUser } }` client and the mocked `@sentry/cloudflare`, as in `src/lib/report-handled-error.test.ts`. They cover:
  - user returned;
  - session missing (no report);
  - `refresh_token_not_found` (no report);
  - 503 (report with step and `http_503`);
  - 429 (warn, no report);
  - a thrown error (report).

#### 3. Middleware

**File**: `src/middleware.ts`

**Intent**: X1. An Auth outage is reported and the user is told to try again, instead of looking signed out.

**Contract**:

- Uses `readSessionUser(supabase, "auth.session")`.
- `locals.user` stays `null` on a fault.
- A protected route without a user redirects to `/auth/signin?error=session_unavailable` when `fault` is true, and to `/auth/signin` otherwise.
- Machine routes and the outer `try`/`catch` are unchanged.

#### 4. Sign-in notice

**File**: `src/lib/signin-errors.ts`, `src/lib/signin-errors.test.ts`

**Intent**: The sign-in page can show the session-check notice.

**Contract**:

- `SignInErrorCode` gains `session_unavailable`, with the message "We couldn't check your sign-in. Try again in a moment."
- `signInErrorMessage("session_unavailable")` returns it (test).

#### 5. Missing secrets reported once per isolate

**File**: `src/lib/missing-secrets.ts` (new), `src/lib/missing-secrets.test.ts` (new), `src/lib/supabase.ts`

**Intent**: X4. A missing or renamed Supabase secret becomes one Sentry issue per secret, instead of silent `null` clients.

**Contract**:

- `reportMissingSecrets(names: readonly string[]): void`.
- For each name not yet reported in this isolate (a module-level `Set`), it calls `reportHandledError("supabase.config", new Error(\`Supabase secret not configured: ${name}\`), { code: \`missing_${name}\` })`.
- `createClient`, `createServiceClient` and `createStatelessClient` call it with the names of their missing variables before returning `null`.
- Export a reset function for tests only, or test through `vi.resetModules()`.
- Tests:
  - the first call reports, and a repeat of the same name does not;
  - a different name reports;
  - the message and tags contain the name only.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Smoke passes against a preview build on port 4322 (the anonymous-redirect steps still expect plain `/auth/signin`): `npm run smoke`

**Implementation Note**: Phase 3's manual probe proves this phase's behaviour end to end. Continue once the automated checks pass.

---

## Phase 2: Auth routes

### Overview

Splits system faults from user errors in set-password, sign-in, forgot-password and the link check (A1–A4, A8).

### Changes Required:

#### 1. Set-password link verification and retry path

**File**: `src/pages/api/auth/set-password.ts`, `src/lib/set-password.ts`, `src/lib/set-password.test.ts`

**Intent**:

- **A1:** only a dead link says "expired". A system fault keeps the link and asks the user to try again.
- **A3:** the retry path no longer hides an Auth fault.

**Contract**:

- `verifyOtp` error:
  - `otp_expired` (or any `VERIFY_OTP_QUIET_CODES`): `console.info("auth set-password: link not usable (<code>, <type>)")`, then `invalidLink()` as today.
  - rate limit: `console.warn` with the `auth set-password: rate limited` prefix, then `setPasswordUrl({ link, error: passwordErrorMessage(error) })`.
  - fault: `reportHandledError("auth.set_password.verify_otp", error)`, then `setPasswordUrl({ link, error: LINK_CHECK_FAILED_MESSAGE })`.
- No-token path: read `getUser()`'s error with `readSessionUser(supabase, "auth.set_password.session")`. On a fault, redirect to `setPasswordUrl({ error: LINK_CHECK_FAILED_MESSAGE })`; otherwise the existing retry-cookie check applies.
- `LINK_CHECK_FAILED_MESSAGE = "Couldn't check your link. Try again in a moment."` is exported from `src/lib/set-password.ts`.
- Test: the message exists and differs from the invalid-link copy.

#### 2. Sign-in

**File**: `src/pages/api/auth/signin.ts`

**Intent**: A4. Wrong passwords stop looking like errors in the logs, and an Auth outage on sign-in reaches Sentry.

**Contract**:

- Quiet codes (`SIGN_IN_QUIET_CODES`): `console.info("auth signin: rejected (<code>)")`.
- Rate limit: `console.warn("auth signin: rate limited (<code|status>)")`.
- Fault: `reportHandledError("auth.signin", error)`.
- The redirect code is still `signInErrorCode(error)`, so the URLs are unchanged.

#### 3. Forgot-password

**File**: `src/pages/api/auth/forgot-password.ts`

**Intent**: A2. A failed reset email, from an SMTP or provider outage, reaches Sentry. The user still sees the same success copy, so the page reveals nothing about accounts.

**Contract**:

- Rate limit: `console.warn("auth forgot-password: rate limited (<code|status>)")`.
- Any other error: `reportHandledError("auth.forgot_password", error)`. `RESET_EMAIL_QUIET_CODES` is empty, so everything else is a fault.
- The redirect is always `?sent=1`.
- The comment at lines 32-33 is updated: unknown emails answer 200, so any remaining error is a rate limit or a fault.

#### 4. Link check

**File**: `src/lib/services/auth-links.ts`, `src/lib/services/auth-links.test.ts`

**Intent**: A8. A link check that always fails, because the function was dropped, a grant was lost or calls time out, shows up in Sentry while the page keeps failing open.

**Contract**:

- The `result.error` branch and the `catch` branch call `reportHandledError("auth.link_check", <error>, { level: "warning" })` instead of `console.warn`.
- The "not configured" skip keeps its warn; `createServiceClient` already reported the missing secret.
- The return values are unchanged.
- Tests:
  - mock `@sentry/cloudflare`;
  - an RPC error and a thrown exception each capture once at level `warning` with step `auth.link_check`;
  - `false` and `true` results capture nothing;
  - the token never appears in the log or the capture arguments.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Smoke passes against a preview build on port 4322 (garbage, used and token-less links still end on `/auth/forgot-password?error=invalid_link`, and a wrong password on `?error=invalid_credentials`): `npm run smoke`

**Implementation Note**: Phase 3's manual probe proves this phase's behaviour end to end. Continue once the automated checks pass.

---

## Phase 3: Docs and runtime proof

### Overview

The docs describe the new reporting and notices, and one manual probe proves that faults are reported, grouped and shown as "try again", while normal cases stay silent.

### Changes Required:

#### 1. Error-monitoring policy

**File**: `docs/deployment.md`

**Intent**: § Error monitoring lists what is now reported. The "until S-09" note is reduced to what is still pending.

**Contract**:

- **Reported:** add the steps `auth.session`, `auth.set_password.verify_otp`, `auth.set_password.session`, `auth.signin`, `auth.forgot_password`, `auth.link_check` (warning) and `supabase.config` (once per missing secret per Worker isolate, code `missing_<NAME>`). Outages without an Auth code group as `http_0` or `http_<status>`.
- **Not reported:** anonymous visits and expired sessions, dead links, wrong passwords, and Auth rate limits (warn lines `auth <site>: rate limited`).
- Keep "invitation and streamed-render failures … until S-10 and S-11".
- § Known risks: add the up-to-30 s session check during an Auth outage (refresh retries).

#### 2. Pages and routes

**File**: `docs/api.md`

**Intent**: The user-visible rules are current.

**Contract**:

- § Pages: protected pages go to `/auth/signin?error=session_unavailable` when the session can't be checked.
- § Accounts and email links: a link that can't be verified because of a system fault keeps the user on the form with the link and "try again"; only a dead link gives "invalid or has expired". The reset request still answers `?sent=1` when sending fails.

### Success Criteria:

#### Automated Verification:

- Formatting passes: `npx prettier --check docs/deployment.md docs/api.md`
- No doc still promises S-09 for auth failures: `grep -n "S-09" docs/` prints nothing

#### Manual Verification:

- Probe setup:
  1. Build with `PUBLIC_SENTRY_DSN=http://public@127.0.0.1:9876/1` and put the same value in `.dev.vars`.
  2. Run a throwaway listener on port 9876 that prints each envelope.
  3. Run a throwaway proxy on port 54399 that forwards to `http://127.0.0.1:54321` and answers 503 for a configurable path prefix. Point `SUPABASE_URL` in `.dev.vars` at it.
  4. Run `npm run preview` on port 4322.
  5. Deliver a week for a test user and sign in ([dev walkthrough](../../../docs/dev-walkthrough.md)).
- Session outage: with the proxy failing `/auth/v1/user`, `/dashboard` redirects to `/auth/signin?error=session_unavailable`, the notice shows, and the listener gets an event fingerprinted `["handled","auth.session","http_503"]`. With the proxy passing through again, a reload of `/dashboard` renders without signing in.
- Anonymous: in a private window, `/dashboard` redirects to plain `/auth/signin` and sends nothing.
- Link fault: request a reset link (Mailpit). With `/auth/v1/verify` failing, posting the form lands back on `/auth/set-password` with the same `token_hash` and "Couldn't check your link. Try again in a moment.", and sends `auth.set_password.verify_otp` `http_503`. With pass-through, the same link then saves the password.
- Sign-in: a wrong password sends nothing. With `/auth/v1/token` failing, sign-in shows "Couldn't sign you in" and sends `auth.signin` `http_503`.
- Reset email: with `/auth/v1/recover` failing, the page still says the link was sent, and `auth.forgot_password` is sent.
- Link check: with `/rest/v1/rpc/auth_link_is_valid` failing, a fresh link still shows the form and sends `auth.link_check` at level `warning`.
- Missing secret: with `SUPABASE_SERVICE_ROLE_KEY` removed from `.dev.vars` (restart preview), opening a link page twice sends exactly one `supabase.config` event with code `missing_SUPABASE_SERVICE_ROLE_KEY` and no key value.
- Privacy: no envelope contains the test user's email, a `token_hash`, a password or a cookie.
- Cleanup: the proxy and listener are stopped, and `.dev.vars` is restored (`SUPABASE_URL`, the service key, no DSN).

**Implementation Note**: After the automated checks pass, pause for the human to confirm the manual probe before opening the PR.

---

## Testing Strategy

### Unit Tests:

- `auth-errors.test.ts`: the quiet-vs-fault matrix per site, built from real `AuthApiError`, `AuthRetryableFetchError`, `AuthUnknownError` and `AuthSessionMissingError` instances.
- `auth-session.test.ts`: the session read for a user, session missing, a quiet code, 429, 503 and a throw.
- `missing-secrets.test.ts`: once-per-isolate behaviour and names only.
- `auth-links.test.ts`: the link check's warning capture without the token.
- `signin-errors.test.ts` and `set-password.test.ts`: the new copy.

### Integration Tests:

- The existing smoke test guards the unchanged user-visible outcomes: anonymous redirects, `invalid_link` for dead links, `invalid_credentials`, and `?sent=1`.

### Manual Testing Steps:

1. Phase 3 probe: inject a 503 with the proxy, trigger the route, read the envelope in the listener, then restore pass-through and confirm recovery.

## Performance Considerations

None beyond the existing behaviour. An Auth outage can already stall the middleware for up to about 30 s while the client retries a refresh. That is recorded as a known risk, not changed.

## Migration Notes

No database change. The new code is behind the existing deploy; nothing has to be applied in Supabase or Sentry before merging.

## References

- Roadmap: `context/foundation/roadmap.md` § S-09; issue #144
- Findings: `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §5 (X1, X4, A1–A4, A8), §6 step 1 and 3
- Helper and pattern: `src/lib/report-handled-error.ts:59`, `src/lib/set-password.ts:125`; S-08 plan `context/archive/2026-10-13-report-handled-errors/plan.md` (probe recipe, Phase 3)
- Auth client error handling: `node_modules/@supabase/auth-js/dist/module/lib/fetch.js:22-80`, `GoTrueClient.js:2675-2731,4296-4314`
- Phase sub-issues: Phase 1 #157, Phase 2 #158, Phase 3 #159

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Classifier, session check and secrets

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — eca3a17
- [x] 1.2 Lint passes: `npm run lint` — eca3a17
- [x] 1.3 Build passes: `npm run build` — eca3a17
- [x] 1.4 Smoke passes against a preview build on port 4322 — eca3a17

### Phase 2: Auth routes

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 8d6796a
- [x] 2.2 Lint passes: `npm run lint` — 8d6796a
- [x] 2.3 Build passes: `npm run build` — 8d6796a
- [x] 2.4 Smoke passes against a preview build on port 4322 — 8d6796a

### Phase 3: Docs and runtime proof

#### Automated

- [x] 3.1 Formatting passes: `npx prettier --check docs/deployment.md docs/api.md` — 8e28edd
- [x] 3.2 No doc still promises S-09 for auth failures — 8e28edd

#### Manual

- [x] 3.3 Probe setup: preview build, local listener, 503 proxy, test user signed in — 8e28edd
- [x] 3.4 Session outage reported as `auth.session` and shown as `session_unavailable`; recovers on reload — 8e28edd
- [x] 3.5 Anonymous visit redirects plainly and sends nothing — 8e28edd
- [x] 3.6 Link fault keeps the link with "try again" and reports `auth.set_password.verify_otp` — 8e28edd
- [x] 3.7 Wrong password silent; sign-in fault reports `auth.signin` — 8e28edd
- [x] 3.8 Reset-email fault keeps the success copy and reports `auth.forgot_password` — 8e28edd
- [x] 3.9 Link-check fault fails open and reports `auth.link_check` at warning — 8e28edd
- [x] 3.10 Missing service key reported once as `supabase.config` — 8e28edd
- [x] 3.11 No email, token, password or cookie in any envelope — 8e28edd
- [x] 3.12 Cleanup: proxy and listener stopped, `.dev.vars` restored — 8e28edd
