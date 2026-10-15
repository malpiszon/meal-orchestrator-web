<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Auth Fault Visibility

- **Plan**: context/changes/auth-fault-visibility/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria: prettier and the `S-09` grep pass; `npm test` 351/351; lint has 0 errors and 3 `no-console` warnings (`auth-session.ts:30`, `report-handled-error.ts:71`), which the Phase 1 review accepted. Manual rows 3.3–3.12 are backed by a scripted probe (curl, local listener, 503 proxy) plus a check of the rendered page copy. The probe served the build with `npx wrangler dev -c dist/server/wrangler.json --port 4322` because `astro preview` timed out on startup.

## Findings

### F1 — Phase 3 docs miss the follow-ups queued by earlier reviews

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: docs/deployment.md § Known risks and § Volume; docs/api.md § Accounts and email links
- **Detail**: `follow-ups/review-fixes.md` queued three items for the Phase 3 docs, and none of them landed. (a) Phase 1 F3: an outage reports `auth.session` once per request that carries a session cookie, and twice for a protected page (the page, then `/auth/signin`). Nothing throttles this, and the events group by code. The Volume paragraph still says "one issue per step". (b) Phase 2 F1, deployment half: a token-less retry during an outage sends 3 events in 2 issues. (c) Phase 2 F1, api.md half: the no-form "Couldn't check your link" page with "Ask for a new link", where a reload after the outage brings the form back.
- **Fix**: Add (a) and (b) to deployment.md (Known risks, and Volume: Auth outages split by code) and (c) to api.md.
- **Decision**: FIXED — Volume groups by step and code; Known risks gains the outage event-count bullet (incl. the token-less retry); api.md describes the no-form retry page

### F2 — Small inaccuracies in the deployment.md Reported and Not reported lists

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: docs/deployment.md:97,99
- **Detail**: Three statements are slightly wrong. (1) "An Auth outage carries no error code, so it groups as `http_0` or `http_<status>`" leaves out `unknown`, which is what a non-JSON answer, a non-`AuthError` throw and the link check's PostgREST 503 produce (the probe saw `auth.link_check` `unknown`). (2) The session check "runs on every request", but the middleware skips MO's machine routes. (3) The rate-limit line is given as `(<code>)`, but every site logs `<code|status>`, and set-password also adds the type.
- **Fix**: Reword the three points: `http_0`/`http_<status>`/`unknown`; "on every request except MO's"; `auth <site>: rate limited (<code or status>)`.
- **Decision**: FIXED — `unknown` grouping added, "except MO's" on the session check, rate-limit line shows `<code or status>`

### F3 — The rate-limit / fault / quiet split is copied at four sites, in two orders

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:35-41, forgot-password.ts:38-45, set-password.ts:68-78, src/lib/auth-session.ts:25-31
- **Detail**: Each site repeats the same three-way branch. The routes check `isAuthRateLimit` first, while `readSessionUser` checks `isAuthSystemFault` first. They disagree only on an `AuthError` with a `*_rate_limit` code and no status, which is an edge case. The real cost is that the routes' copies are untested (see F4), and the plan's goal was that "call sites can't drift".
- **Fix A ⭐ Recommended**: Add `classifyAuthError(error, quietCodes): "rate_limit" | "fault" | "quiet"` to `auth-errors.ts`, unit-test it, and switch on it at the four sites.
  - Strength: one tested decision point; removes the ordering difference; makes F4 cheap.
  - Tradeoff: touches four reviewed and probed files after the probe; a re-run of smoke is needed.
  - Confidence: HIGH — mechanical refactor; the classifier tests already exist.
  - Blind spot: whether the per-site log wording stays identical.
- **Fix B**: Leave the code as it is and record it as a follow-up.
  - Strength: no change to probed code before the PR.
  - Tradeoff: the drift risk stays.
  - Confidence: MED — the divergence is real but rare.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — `classifyAuthError` in `auth-errors.ts` (fault before rate limit) with tests, break-checked red; the four sites switch on it. Tests 357/357, lint 0 errors, build OK. Smoke under `wrangler dev`: all auth steps pass; 3 MO-delivery steps fail identically with and without this fix (wrangler ProxyWorker drops the request after a 401), so they are environmental; `astro preview` would not start locally

### F4 — Route-level fault branches have no automated test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/api/auth/set-password.ts:68-86, signin.ts:33-43, forgot-password.ts:38-46, src/middleware.ts:21-34
- **Detail**: The repo has no route tests, and the plan relies on the manual probe for these branches. A change that sent a verify fault back to `invalidLink()` would keep every test green. Smoke covers only the quiet outcomes.
- **Fix**: Follow-up: once F3 lands, test the redirect decision through the lib helper; otherwise accept the probe as the guard.
- **Decision**: FIXED — queued as a follow-up in `follow-ups/review-fixes.md`; the probe guards this PR

### F5 — A rate-limited session check signs the user out without a message

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:33, src/lib/auth-session.ts:29-32
- **Detail**: A 429 returns `fault: false`, so the redirect goes to plain `/auth/signin`. On a refresh of an expired access token, auth-js also removes the session for a non-retryable error. The user looks signed out, then likely gets `rate_limited` on the next sign-in.
- **Fix**: Follow-up: return a `rateLimited` flag from `readSessionUser` and redirect with the existing `?error=rate_limited` (still no Sentry event).
- **Decision**: FIXED — `readSessionUser` returns `rateLimited`; the middleware redirects protected pages to `/auth/signin?error=rate_limited` (no Sentry event); test updated and break-checked red; `docs/api.md` § Pages updated

### F6 — `bad_jwt` and `no_authorization` at the session check can hide a config fault

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts:12-22
- **Detail**: With a cookie session, auth-js refreshes before expiry and always sends the bearer, so a flood of these codes points to a JWT key rotation or secret mismatch, or to a proxy stripping `Authorization`. Every user would then quietly look signed out. The plan chose them as quiet (probed as normal signed-out cases).
- **Fix**: Follow-up: log these two at `console.warn` (or report at `warning`) so a mass occurrence shows in the Worker logs.
- **Decision**: FIXED — `readSessionUser` logs `auth session: signed out by <code>` at warn for `bad_jwt`/`no_authorization` (no report); tests added and break-checked red; deployment.md Not reported updated

### F7 — `auth.link_check` outages group as `unknown`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/auth-links.ts:35
- **Detail**: The probe's 503 from PostgREST produced fingerprint `["handled","auth.link_check","unknown"]`. The PostgREST error carries no status, so timeouts, outages and a dropped function all share one issue. The message still tells them apart.
- **Fix**: Accept it (document under F2), or pass `result.status` into the report's code.
- **Decision**: ACCEPTED — grouping as `unknown` kept; documented in deployment.md by the F2 fix

### F8 — `readSessionUser` sits outside `services/` though it calls Supabase

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/auth-session.ts
- **Detail**: The README says "services/ talk to Supabase", and its siblings that call a client (`auth-links`, `plans`, `ratings`) live there. The plan named `src/lib/auth-session.ts`.
- **Fix**: Move it and its test to `src/lib/services/`.
- **Decision**: FIXED — moved to `src/lib/services/auth-session.ts` (+ test); imports in `middleware.ts` and `set-password.ts` updated

### F9 — Dead `over_request_rate_limit` case in `signInErrorCode`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/signin-errors.ts:29-30
- **Detail**: For a real `AuthError`, `isAuthRateLimit` returns first. The case survives only for old tests that pass plain `{ code }` objects, which `isAuthRateLimit` rejects.
- **Fix**: Drop the case and switch those tests to `AuthApiError` instances.
- **Decision**: FIXED — dead case removed; `over_request_rate_limit` tested as a real 429 `AuthApiError`

### F10 — set-password renders free text from `?error=` (pre-existing)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/set-password.astro:49,72
- **Detail**: Escaped, so it isn't an XSS, but a crafted link can show any message on the real domain. This change adds a text-equality check on that channel. Sign-in uses fixed codes instead.
- **Fix**: Follow-up outside S-09: move set-password to error codes mapped to fixed copy, as in `signin-errors.ts`.
- **Decision**: FIXED — queued as a follow-up outside S-09 in `follow-ups/review-fixes.md`
