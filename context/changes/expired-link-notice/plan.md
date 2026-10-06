# Expired Link Notice on Open Implementation Plan

## Overview

S-10 ([#67](https://github.com/malpiszon/meal-orchestrator-web/issues/67)): when a user opens an invitation or password-reset link that has expired, was already used or was replaced by a newer one, `/auth/set-password` shows "This link is invalid or has expired." with "Ask for a new link" straight away, instead of a password form that can only fail on submit. A valid link still shows the form. The check on open is a read-only database lookup that mirrors Supabase Auth's own verify rule; it never uses the token and never signs anyone in. The POST-time `verifyOtp` error stays as the fallback for a link that dies while the form is open.

## Current State Analysis

- `src/pages/auth/set-password.astro:30-41` only format-checks `token_hash`/`type` (`setPasswordLinkSchema`). Any well-formed token shows the form; the "invalid or has expired" branch (`:52`, `:58-64`) is reached only without a token (and without the retry cookie).
- `src/pages/api/auth/set-password.ts:62-68` verifies the token only on POST and redirects a dead link to `/auth/forgot-password?error=…` (`:16`, `:30-31`). This stays unchanged.
- Supabase Auth has no endpoint that checks a token without using it (research, "Summary"). GoTrue v2.197.0 and master accept a `token_hash` link only when (1) a row with that `token_hash` and matching `token_type` exists in `auth.one_time_tokens` (`confirmation_token` for `invite`, `recovery_token` for `recovery`), and (2) `now <= sent_at + Mailer.OtpExp`, where `sent_at` is `users.confirmation_sent_at` (invite) or `users.recovery_sent_at` (recovery). Every leg was confirmed on the local stack (research, "Local confirmation").
- Using a link deletes all of the user's `one_time_tokens` rows; generating a new link of a type replaces that type's row. So "row missing" covers used, replaced and made-up links, and the time check covers expired links. GoTrue answers all of them with the same `otp_expired`, so "invalid or has expired" is the only honest message.
- The link lifetime (`GOTRUE_MAILER_OTP_EXP`) is not readable from SQL. It is `otp_expiry = 3600` in `supabase/config.toml:217` locally and the dashboard's "Email OTP Expiration" in production.
- Precedent for a `security definer` function reading `auth.*`, granted only to `service_role` and called through `createServiceClient()`: `ingest_weekly_plan` (`supabase/migrations/20261001120000_weekly_plans.sql:67-124`, `src/pages/api/mo/deliveries.ts:56`).

## Desired End State

- Opening `/auth/set-password?token_hash=…&type=invite|recovery` with a used, replaced, made-up or expired token shows the invalid-link notice and "Ask for a new link"; no form.
- Opening it with a valid token shows the form, and the token is still usable afterwards (no session is created on GET).
- If the check can't run (service key missing, RPC error, function missing), the page shows the form as it does today and logs a warning; submitting a dead link still ends on `/auth/forgot-password` with the error.
- pgTAP, unit tests and the smoke test cover these cases; CI runs them.

Verify: `npx supabase test db`, `npm test`, `npm run lint`, the smoke test against a preview, and a real expired reset link in production.

### Key Discoveries:

- Verify predicate and token mechanics: `context/changes/expired-link-notice/research.md` ("Supabase Auth verify predicate (source)", "Local confirmation").
- Service-role function pattern: `supabase/migrations/20261001120000_weekly_plans.sql:67-79,121-124`.
- `createServiceClient()` doc says "never use it in a user-facing code path" (`src/lib/supabase.ts:25-27`); this plan narrows that wording.
- Smoke helpers already exist: `openSetPasswordPage(tokenHash, type)` (`scripts/smoke.mjs:310-312`), `generateLinkToken(type, email)`, and steps asserting the invalid-link text (`scripts/smoke.mjs:668-678`).
- `auth.one_time_tokens` columns: `id, user_id, token_type (auth.one_time_token_type), token_hash, relates_to, created_at, updated_at, expires_at`; unique `(user_id, token_type)`.

## What We're NOT Doing

- No call to GoTrue's verify on GET and no session on GET (S-05/S-04 rule, mail-scanner prefetch and login CSRF).
- No change to the POST route or its error; it stays the fallback.
- No distinction between "expired", "used" and "replaced" in the message (GoTrue doesn't distinguish them either).
- No banned-user check: a banned user still gets the POST-time error.
- No change to the link lifetime: it stays 3600 s; no env var or secret for it.
- No use of `one_time_tokens.expires_at` or upstream's experimental `link_token_hash`/`EnableOTTAsSourceOfTruth`: GoTrue's current verify path doesn't read them.
- No change to `/api/auth/confirm`: it forwards to the page, so the page's check covers old-style links.

## Implementation Approach

A `security definer` SQL function owned by `postgres` answers "would GoTrue accept this `token_hash` for this type right now?", taking the lifetime as an argument so the number lives only in the app. Only `service_role` may execute it. The page calls it through `createServiceClient()` via a small helper that fails open: any problem means "show the form" plus a warning log. A dead link is treated exactly like a missing link: the page renders the existing invalid-link branch. The app's lifetime constant is pinned to `config.toml` by a unit test and to production by a README setup step.

## Critical Implementation Details

- **Bias towards "valid".** A wrong "valid" is today's behaviour (the POST catches it); a wrong "invalid" locks the user out of a live link. So every failure path in the helper returns "valid", and the constant must not be shorter than the production setting.
- **Never log the token.** Warnings name the failure (`code`, `message`) and link type only, never `token_hash`.
- **Dead token = no token.** When the link is dead, the page must not pass its `token_hash` to the form. A signed-in user with a live retry cookie then gets the token-less retry form (which works) rather than a form that posts a dead token.
- **Production ordering.** The migration must be pushed before the merge (README timing). If hosted `postgres` can't read `auth.one_time_tokens`, a `language sql` function fails at `db push` time (bodies are checked at creation), which is the signal to stop; if it somehow fails at runtime instead, the page fails open.

## Phase 1: Database link check

### Overview

Add the read-only `auth_link_is_valid` function and pin its behaviour with pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261005120000_auth_link_is_valid.sql`

**Intent**: A function that mirrors the first two steps of GoTrue's `verifyTokenHash` (token row lookup by hash and type, then the sent-at + lifetime check) without changing anything. A header comment names the GoTrue version it mirrors (v2.197.0), the research doc, and that it reads Supabase-managed tables that may change on upgrade.

**Contract**: `public.auth_link_is_valid(p_token_hash text, p_type text, p_lifetime_seconds integer) returns boolean`, `language sql stable security definer set search_path = ''`. Returns `false` for an unknown `p_type`, a missing row, a `null` sent-at or an expired link. `revoke execute … from public, anon, authenticated; grant execute … to service_role;`.

```sql
select exists (
  select 1
    from auth.one_time_tokens ott
    join auth.users u on u.id = ott.user_id
   where ott.token_hash = p_token_hash
     and (
       (p_type = 'invite' and ott.token_type = 'confirmation_token'
          and now() <= u.confirmation_sent_at + make_interval(secs => p_lifetime_seconds))
       or
       (p_type = 'recovery' and ott.token_type = 'recovery_token'
          and now() <= u.recovery_sent_at + make_interval(secs => p_lifetime_seconds))
     )
);
```

#### 2. pgTAP test

**File**: `supabase/tests/auth_link_is_valid.test.sql`

**Intent**: Pin the predicate and the grants, following `supabase/tests/get_plan_recency.test.sql` (seed `auth.users` and `auth.one_time_tokens` directly, sent-at values relative to `now()`).

**Contract**: Cases, all with lifetime 3600:
- valid recovery link → true
- valid invite link → true
- unknown hash (used, replaced or made up) → false
- recovery hash asked as `invite`, and the reverse → false
- recovery sent 61 min ago → false; invite sent 61 min ago → false; sent 59 min ago → true
- `null` sent-at → false
- unknown type (e.g. `signup`) → false
- `anon` and `authenticated` lack execute; `service_role` has it

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- pgTAP passes: `npx supabase test db`

#### Manual Verification:

- Local probe with real GoTrue rows: after Admin `generate_link` (recovery), `rpc('auth_link_is_valid')` with the service role returns true; after `POST /auth/v1/verify` with that hash it returns false

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Page shows the notice on open

### Overview

Add the lifetime constant, a fail-open check helper, and wire it into the set-password page.

### Changes Required:

#### 1. Lifetime constant

**File**: `src/lib/set-password.ts`

**Intent**: One app-side value for the link lifetime, documented as "must equal `otp_expiry` in `supabase/config.toml` and the production dashboard's Email OTP Expiration".

**Contract**: `export const AUTH_LINK_LIFETIME_SECONDS = 3600;`

#### 2. Drift test

**File**: `src/lib/set-password.test.ts`

**Intent**: Fail CI if `config.toml`'s `otp_expiry` (under `[auth.email]`) and the constant differ.

**Contract**: Reads `supabase/config.toml` with `node:fs`, extracts `otp_expiry`, expects it to equal `AUTH_LINK_LIFETIME_SECONDS`.

#### 3. Check helper

**File**: `src/lib/services/auth-links.ts` (+ `src/lib/services/auth-links.test.ts`)

**Intent**: Ask the database whether an emailed link is still usable, failing open. A `null` client (service key or URL missing) or an RPC error returns `true` and logs a `console.warn` naming the failure and link type (never the token).

**Contract**: `isSetPasswordLinkLive(supabase: SupabaseClient | null, link: SetPasswordLink): Promise<boolean>`. Calls `supabase.rpc("auth_link_is_valid", { p_token_hash, p_type, p_lifetime_seconds: AUTH_LINK_LIFETIME_SECONDS })`. Unit tests (mocked `rpc`, like `src/lib/services/plans.test.ts`):
- `data: true` → true
- `data: false` → false
- error → true and a warning without the token
- `null` client → true and a warning
- passes the constant as `p_lifetime_seconds`

#### 4. Page wiring

**File**: `src/pages/auth/set-password.astro`

**Intent**: After parsing, check a well-formed link; a dead link is treated as no link. Update the comment at `:30` ("Only read the token here…") to say the token is checked read-only, never used.

**Contract**: `link` stays `undefined` when the check says dead, so the existing `showForm = link !== undefined || isRetry` and the invalid-link branch apply unchanged. The `WORDING` title still follows the URL's `type` (an invite link keeps "Set your password").

#### 5. Service-client comment

**File**: `src/lib/supabase.ts`

**Intent**: Narrow the "never use it in a user-facing code path" wording to allow read-only, service-role-only RPCs such as the link check, with the reason (no session on a fresh link click).

**Contract**: Doc comment only.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Types check: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- On `npm run dev`: a fresh reset link from Mailpit shows the form; after saving a password, reopening the same link shows the notice and "Ask for a new link"
- Opening a fresh invite link shows "Set your password" with the form; reopening it after use shows the notice

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Smoke, README and production

### Overview

Guard the behaviour end-to-end against real GoTrue, document it, and roll it out to production.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove against real GoTrue that dead links show the notice on GET and valid links still show the form without using the token. Reuse `openSetPasswordPage` and the existing invalid-link assertion (message present, no `action="/api/auth/set-password"`).

**Contract**: New steps:
- invite link opened on the page (`type=invite`) shows the form, before the existing "new password from the invitation signs the user in"
- after that step, the used invite link shows the notice
- after "used password-reset link is rejected", the used reset link opened on the page shows the notice
- a made-up token opened on the page shows the notice
- replaced link: generate two recovery links for the same user; the first shows the notice and the second shows the form (placed where no later step depends on the second token, or the step uses it up afterwards)

The existing "page shows form" and "token survived the GET" steps stay as the valid-link guard.

#### 2. README

**File**: `README.md`

**Intent**:
- Auth routes: opening a used, replaced, made-up or expired link now shows "This link is invalid or has expired" on the page itself, still without using the token; the POST error stays for a link that dies while the form is open.
- Production setup for email links: a step to set **Authentication → Providers → Email → Email OTP Expiration** to `3600` (must equal `AUTH_LINK_LIFETIME_SECONDS` and `otp_expiry`), with the before-merge timing.
- The migration-timing paragraph: name `auth_link_is_valid`.
- A note that the check reads Supabase-managed `auth.one_time_tokens`/`auth.users` and fails open; the pgTAP test and smoke steps catch an upgrade that breaks it.
- Smoke section: list the new steps.

**Contract**: Prose only, in the existing sections.

### Success Criteria:

#### Automated Verification:

- Smoke passes locally against a preview on :4322 with `SUPABASE_SERVICE_ROLE_KEY`, `MO_INGEST_TOKEN` and `MAILPIT_URL` set: `BASE_URL=http://localhost:4322 … npm run smoke`
- CI `ci` and `smoke` jobs pass on the PR
- Formatting passes: `npx prettier --check README.md`

#### Manual Verification:

- Before merging: `npx supabase db push` to production succeeds, and the production dashboard's Email OTP Expiration is confirmed at `3600`
- After deploy: a real reset link older than an hour (or used) opened in production shows the notice; a fresh one shows the form and saving with it works
- Worker logs show no `auth_link_is_valid` warnings after the production checks

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isSetPasswordLinkLive`: true, false, error → true with warning, null client → true with warning, lifetime argument.
- `AUTH_LINK_LIFETIME_SECONDS` equals `config.toml` `otp_expiry`.

### Integration Tests:

- pgTAP `auth_link_is_valid.test.sql`: predicate per type, expiry boundaries, null sent-at, unknown type, grants.
- Smoke: valid invite and reset links show the form and stay usable; used invite, used reset, replaced and made-up links show the notice.

### Manual Testing Steps:

1. Locally, request a reset, open the Mailpit link: form. Save a password, reopen the link: notice.
2. Locally, deliver for a new email, open the invite in Mailpit: form. Use it, reopen: notice.
3. Production, after deploy: open a reset link older than an hour: notice, with "Ask for a new link" going to `/auth/forgot-password`.

## Performance Considerations

One extra RPC (about one round trip) per GET of the page with a token. The lookup uses the existing hash index on `one_time_tokens.token_hash` and the primary key of `auth.users`.

## Migration Notes

New function only; no data changes. Push to production after CI is green and before merging (README timing). Rollback: dropping the function makes the page fail open, which is today's behaviour.

## References

- Research: `context/changes/expired-link-notice/research.md`
- Roadmap: `context/foundation/roadmap.md` § S-10; issue [#67](https://github.com/malpiszon/meal-orchestrator-web/issues/67)
- Service-role function pattern: `supabase/migrations/20261001120000_weekly_plans.sql:67-124`
- Page and fallback: `src/pages/auth/set-password.astro:30-64`, `src/pages/api/auth/set-password.ts:16,30-31,62-68`
- Prior rule (no verify on GET): `context/archive/2026-10-04-password-reset/plan.md`, `context/archive/2026-10-03-email-link-callback/follow-ups/review-fixes.md`
- Phase sub-issues: #68 (Phase 1), #69 (Phase 2), #70 (Phase 3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database link check

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset` — 39e455d
- [x] 1.2 pgTAP passes: `npx supabase test db` — 39e455d

#### Manual

- [x] 1.3 Local probe with real GoTrue rows: after Admin `generate_link` (recovery), `rpc('auth_link_is_valid')` with the service role returns true; after `POST /auth/v1/verify` with that hash it returns false — 39e455d

### Phase 2: Page shows the notice on open

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 80a2aa5
- [x] 2.2 Lint passes: `npm run lint` — 80a2aa5
- [x] 2.3 Types check: `npx astro check` — 80a2aa5
- [x] 2.4 Build succeeds: `npm run build` — 80a2aa5

#### Manual

- [x] 2.5 On `npm run dev`: a fresh reset link from Mailpit shows the form; after saving a password, reopening the same link shows the notice and "Ask for a new link" — 80a2aa5
- [x] 2.6 Opening a fresh invite link shows "Set your password" with the form; reopening it after use shows the notice — 80a2aa5

### Phase 3: Smoke, README and production

#### Automated

- [x] 3.1 Smoke passes locally against a preview on :4322 with `SUPABASE_SERVICE_ROLE_KEY`, `MO_INGEST_TOKEN` and `MAILPIT_URL` set: `BASE_URL=http://localhost:4322 … npm run smoke`
- [ ] 3.2 CI `ci` and `smoke` jobs pass on the PR
- [x] 3.3 Formatting passes: `npx prettier --check README.md`

#### Manual

- [ ] 3.4 Before merging: `npx supabase db push` to production succeeds, and the production dashboard's Email OTP Expiration is confirmed at `3600`
- [ ] 3.5 After deploy: a real reset link older than an hour (or used) opened in production shows the notice; a fresh one shows the form and saving with it works
- [ ] 3.6 Worker logs show no `auth_link_is_valid` warnings after the production checks
