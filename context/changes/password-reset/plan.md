# Password reset Implementation Plan

## Overview

A user who has forgotten their password, or never set one, asks for a reset link by email, opens it, chooses a new password of 8+ characters and lands signed in on `/dashboard` (roadmap S-05, issue #5; FR-005, US-04). The emailed token is used only when the new-password form is posted, never when the link is opened, which closes the mail-scanner and login-CSRF gaps F-01 handed over. The new-password page is built to be shared: S-04 (invitation) reuses it by adding the `invite` link type.

## Current State Analysis

- `GET /api/auth/confirm` (`src/pages/api/auth/confirm.ts:10`) validates `token_hash` + `type` (`invite` | `recovery`) with `authLinkQuerySchema` (`src/lib/auth-link.ts:8`), calls `verifyOtp` on the GET and redirects to `AUTH_LINK_DESTINATION = "/dashboard"` (`src/lib/auth-link.ts:16`). Opening a reset link therefore signs the user in but gives them no way to choose a password.
- F-01's handoff (roadmap F-01 block; comments on #5): the GET-side `verifyOtp` lets link-prefetching mail scanners burn the single-use token, and lets any site sign a victim in as the attacker (login CSRF). Fix: a page that takes `token_hash` + `type` on GET and calls `verifyOtp` only on the form POST.
- `supabase/templates/recovery.html` links to `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`. Production templates are pasted by hand (README "Production setup for email links (one-time)").
- No reset request form, no new-password page, no link on `/auth/signin` (`src/pages/auth/signin.astro`, `src/components/auth/SignInForm.tsx`).
- Auth forms post plain HTML forms to `src/pages/api/auth/*.ts`, which redirect back with `?error=` (`src/pages/api/auth/signin.ts`). Reusable pieces: `FormField`, `PasswordToggle`, `SubmitButton`, `ServerError` in `src/components/auth/`.
- `security: { checkOrigin: true }` (`astro.config.mjs:17`) rejects cross-site form POSTs, so a POST-only `verifyOtp` cannot be triggered from another site.
- MO deliveries create accounts with `admin.createUser({ email_confirm: false })`, no password, `app_metadata.provisioned_by = "mo-delivery"` (`src/pages/api/mo/deliveries.ts:109`). GoTrue sends a recovery email to such an account and confirms it when the recovery token is verified, so the reset flow doubles as the way a delivery-created account claims itself (decided: allowed, tested and documented).
- Supabase password minimum is 6 (`supabase/config.toml:175`); `SignUpForm.tsx:8` mirrors it as `MIN_PASSWORD_LENGTH = 6`.
- Smoke (`scripts/smoke.mjs:233`) creates reset tokens via the Admin API `generate_link` and opens them through `/api/auth/confirm` (steps at `scripts/smoke.mjs:448-480`), which this change replaces. CI smoke runs a local Supabase whose Mailpit is reachable at `http://127.0.0.1:54324` (`.github/workflows/ci.yml:53`).

## Desired End State

- `/auth/signin` shows a "Forgot or never set a password?" link to `/auth/forgot-password`.
- Submitting an email there always shows "If an account exists for that email, we've sent a link to set a new password"; only a rate limit or a Supabase failure shows an error.
- The email links to `/auth/set-password?token_hash=…&type=recovery`. Opening it (or having a scanner open it) uses nothing; the page shows a new-password form.
- Posting a password of 8+ characters verifies the token, saves the password, and redirects to `/dashboard` signed in. The user can later sign in with the new password; the old one fails.
- A too-short password is rejected before the token is used. A reused, expired or made-up token sends the user to `/auth/forgot-password` with "This link is invalid or has expired. Ask for a new one."
- A delivery-created account without a password can set one this way and sees its own plan.
- Old-style links (`/api/auth/confirm?…&type=recovery`) are forwarded to the new page without being verified.
- Supabase requires 8+ characters locally and in production; the sign-up form says so too.
- CI smoke proves all of the above, including one real email read from Mailpit.

### Key Discoveries:

- `src/pages/api/auth/confirm.ts:25` — the GET-side `verifyOtp` to remove for `recovery`; `invite` keeps it until S-04.
- `src/lib/auth-link.ts:16` — the destination constant F-01 said the first slice should make per-type.
- `src/pages/api/mo/deliveries.ts:109` — delivery-created accounts are unconfirmed and passwordless; the reset flow confirms and claims them.
- `astro.config.mjs:17` — origin check is the CSRF guard for the new POST routes; keep it.
- `scripts/smoke.mjs:233` — `generateLinkToken` stays the token source for most smoke steps; `openEmailLink` changes meaning.

## What We're NOT Doing

- No invitations and no `invite` type on the new page (S-04). `/api/auth/confirm` keeps handling `invite` exactly as today.
- No change-password screen for signed-in users (old password + new password) and no MFA (FR-006, parked).
- No "this email has no account" message: the request form never reveals which emails exist.
- No blocking of resets for delivery-created accounts.
- No password-confirmation (type twice) field; the show/hide toggle covers typos.
- No restyle of the auth pages or landing page (S-09); new pages follow the existing sign-in card layout.
- No forced re-login after the reset; the user stays signed in.
- No removal of the public sign-up (S-04); only its minimum length text changes.

## Implementation Approach

Two plain-HTML-form flows in the existing auth style. The request form posts to an API route that asks Supabase to send the recovery email through a cookie-less anon client. The emailed link opens a server-rendered page that only reads the token into hidden fields; the page's form posts to a second API route that checks the password, verifies the token (which creates the session cookies), saves the password, and redirects. The link type is a parameter of the page and route from the start (accepting only `recovery` here), so S-04 adds `invite` without restructuring. `/api/auth/confirm` forwards `recovery` links to the page, which makes the production template step and the deploy independent of each other.

## Critical Implementation Details

**State sequencing.** In `POST /api/auth/set-password`, validate the password length *before* `verifyOtp`: once verified, the token is gone. If `updateUser` still fails after a successful `verifyOtp` (weak or same-as-old password, Supabase error), the user already has a session, so redirect to `/auth/set-password?error=…` *without* the token; the page then renders the form in "signed-in" mode and the POST route accepts a password change from the session alone. Without this, a rejected password would strand the user with a used link.

**Request client.** Send the reset email through a cookie-less anon client (`flowType: "implicit"`, `persistSession: false`), not the cookie-bound SSR client. The SSR client uses PKCE and would set a code-verifier cookie in the requesting browser; the reset is often finished in another browser, and implicit-flow token hashes are what `verifyOtp({ token_hash, type })` is already proven to accept (F-01 smoke). The Mailpit smoke step verifies a real email's token end to end.

**Token hygiene.** `/auth/set-password` carries the token in its URL, so send it with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Phase 1: Request a reset link

### Overview

The user can reach a "set a new password" request form from sign-in and submit their email; Supabase sends the recovery email. Shared password and link-type rules land in one module with unit tests, and the 8-character minimum is set.

### Changes Required:

#### 1. Shared password-reset rules

**File**: `src/lib/set-password.ts` (new), `src/lib/set-password.test.ts` (new)

**Intent**: One place for the rules both routes, both forms and the sign-up form use, so the minimum length and accepted link types can't drift.

**Contract**: exports `MIN_PASSWORD_LENGTH = 8`; `resetRequestSchema` (`{ email }`, trimmed, valid email); `setPasswordLinkSchema` (`{ token_hash: non-empty, type: "recovery" }` — the type enum S-04 extends with `"invite"`); `setPasswordFormSchema` (`password` ≥ `MIN_PASSWORD_LENGTH`, optional `token_hash` + `type` that must both be present or both absent); `SET_PASSWORD_PATH = "/auth/set-password"`, `FORGOT_PASSWORD_PATH = "/auth/forgot-password"`; and `passwordErrorMessage(error)` mapping GoTrue error codes (`weak_password`, `same_password`, `over_email_send_rate_limit`/HTTP 429) to friendly text with a generic fallback (raw messages are logged, never shown). Tests cover: valid/invalid emails; `recovery` accepted, `invite`/`signup`/missing rejected; 7 vs 8 characters; token fields both-or-neither; each mapped code and the fallback.

#### 2. Cookie-less anon client

**File**: `src/lib/supabase.ts`

**Intent**: A client for auth calls that must not touch the requester's cookies (the reset request).

**Contract**: `createStatelessClient(): SupabaseClient | null` using `SUPABASE_URL` + `SUPABASE_KEY`, `auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" }`; returns `null` when unconfigured, like `createClient`.

#### 3. Reset request route

**File**: `src/pages/api/auth/forgot-password.ts` (new)

**Intent**: Ask Supabase to send the recovery email without revealing whether the account exists.

**Contract**: `export const prerender = false`; `POST` reads form data, validates with `resetRequestSchema` (invalid → 302 `/auth/forgot-password?error=Enter a valid email address`), calls `resetPasswordForEmail(email)` on the stateless client with no `redirectTo` (the template builds the link from `{{ .SiteURL }}`). Success, including unknown emails → 302 `/auth/forgot-password?sent=1`. Rate limit → 302 with a "too many requests, try again later" error; other errors → logged, 302 with a generic error. Unconfigured Supabase → 302 with "Supabase is not configured", as the other auth routes do.

#### 4. Request page and form

**File**: `src/pages/auth/forgot-password.astro` (new), `src/components/auth/ForgotPasswordForm.tsx` (new)

**Intent**: The request form, in the sign-in card layout, with neutral copy that fits both "forgot" and "never set".

**Contract**: page title/heading "Set a new password"; a description saying we'll email a link to set a new password. `?sent=1` replaces the form with the same-for-everyone confirmation message and a "Back to sign in" link; `?error=` is passed to the form's `ServerError`. The form mirrors `SignInForm` (email `FormField`, client-side email check, `SubmitButton`) and posts to `/api/auth/forgot-password`. Design tokens and shadcn variants only.

#### 5. Sign-in entry point

**File**: `src/components/auth/SignInForm.tsx` (or `src/pages/auth/signin.astro`)

**Intent**: Make the flow discoverable, including for MO users whose account was created by a delivery.

**Contract**: a link "Forgot or never set a password?" to `/auth/forgot-password`, styled with `buttonVariants({ variant: "link" })` or an existing token class, near the password field or under the submit button.

#### 6. Eight-character minimum

**File**: `supabase/config.toml`, `src/components/auth/SignUpForm.tsx`

**Intent**: Supabase enforces 8+ for every password set from now on; the sign-up form stops promising 6.

**Contract**: `minimum_password_length = 8`; `SignUpForm` imports `MIN_PASSWORD_LENGTH` from `@/lib/set-password` instead of its local `6`, and its placeholder reads "Min. 8 characters". Local Supabase reads `config.toml` only at start; restarting the shared stack is the user's call.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new `src/lib/set-password.test.ts`: `npm test`
- Lint passes: `npm run lint`
- Type and Astro checks pass: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- After restarting local Supabase (user), `/auth/signin` shows "Forgot or never set a password?", and submitting the smoke-style email on `/auth/forgot-password` shows the confirmation; the recovery email appears in Mailpit (`http://127.0.0.1:54324`)
- Submitting an email with no account shows the same confirmation and no email arrives in Mailpit
- Signing up locally with a 7-character password is rejected; the form says "Min. 8 characters"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Set the new password from the link

### Overview

The emailed link opens a page that reads the token without using it; posting a valid password verifies the token, saves the password and signs the user in. The recovery template and `/api/auth/confirm` point reset links at this page.

### Changes Required:

#### 1. New-password page and form

**File**: `src/pages/auth/set-password.astro` (new), `src/components/auth/SetPasswordForm.tsx` (new)

**Intent**: Show the new-password form for a reset link, or for a signed-in user retrying after a rejected password, without touching the token.

**Contract**: not in `PROTECTED_ROUTES`; responds with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Three states:
- query passes `setPasswordLinkSchema` → form with hidden `token_hash` + `type`;
- no token but `Astro.locals.user` is set → form without hidden fields;
- otherwise → "This link is invalid or has expired" with a link to `/auth/forgot-password`.

`?error=` shows in `ServerError`. The form has one password `FormField` with `PasswordToggle`, a client-side `MIN_PASSWORD_LENGTH` check with the remaining-characters hint `SignUpForm` uses, and a `SubmitButton` ("Save password"); it posts to `/api/auth/set-password`. The page never calls `verifyOtp`. Wording is chosen by `type` through a small map, so S-04 adds the invite wording there.

#### 2. Set-password route

**File**: `src/pages/api/auth/set-password.ts` (new)

**Intent**: Verify the token only on POST, then save the password, keeping a rejected password recoverable.

**Contract**: `export const prerender = false`; `POST` with form data. Steps, in order:
1. Parse with `setPasswordFormSchema`. A too-short password → 302 back to `/auth/set-password` with the same `token_hash`/`type` (when given) and the error; the token stays unused.
2. If the token fields are present, `verifyOtp({ token_hash, type })` on the cookie-bound SSR client. Failure → logged, 302 `/auth/forgot-password?error=This link is invalid or has expired. Ask for a new one.`
3. If they are absent and there is no session (`getUser()`), same redirect.
4. `updateUser({ password })`. Failure → logged, 302 `/auth/set-password?error=<passwordErrorMessage>` without the token (the session from step 2 lets the user retry).
5. Success → 302 `/dashboard`.

Unconfigured Supabase → 302 `/auth/signin?error=Supabase is not configured`.

#### 3. Point reset links at the page

**File**: `supabase/templates/recovery.html`, `src/pages/api/auth/confirm.ts`, `src/lib/auth-link.ts`, `src/lib/auth-link.test.ts`

**Intent**: New emails link straight to the page; old-style links (emails sent before the deploy, or production before its template is re-pasted) are forwarded there without verification, so no GET ever uses a reset token.

**Contract**: the template link becomes `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=recovery` (copy stays "set a new password"; no `{{ .ConfirmationURL }}`). In `/api/auth/confirm`, a valid query with `type === "recovery"` → 302 to `SET_PASSWORD_PATH` with the same `token_hash` and `type`, no `verifyOtp`; `invite` is unchanged. The destination becomes per-type in `src/lib/auth-link.ts` (e.g. `invite` → `/dashboard`, `recovery` → forward to the set-password page), with a comment that S-04 moves `invite` to the page too; the unit tests cover the mapping.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type and Astro checks pass: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- After restarting local Supabase (user), the Mailpit reset email links to `/auth/set-password?…&type=recovery`; opening it shows the form, and opening it a second time still shows the form (token not used)
- A 7-character password is rejected with the token kept; an 8+ character password lands on `/dashboard`; signing out and in with the new password works and the old one fails
- Opening the same link after a successful reset and posting a password ends on `/auth/forgot-password` with the invalid-link message
- A delivery-created account (README walkthrough step 1, without step 2's Admin API call) can request a reset, set a password, and sees its delivered week

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Smoke coverage, docs and production hand-off

### Overview

CI proves the whole flow on the Workers runtime, including a real email from Mailpit and a delivery-created account. The README and the production one-time steps are updated, and S-04 gets its handoff.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Replace F-01's "reset link signs the user in" steps with the new flow, and prove the token survives a GET.

**Contract**: keep `generateLinkToken`; add helpers to open the set-password page and post its form; track the smoke user's current password (it changes). All steps sit inside the existing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` gate, after the steps that sign in with the original password.

Steps, in this order:
- `POST /api/auth/forgot-password` with an unknown email → 302 `…?sent=1`; with `not-an-email` → 302 `…?error=`
- old-style recovery link via `/api/auth/confirm` → 302 to `/auth/set-password?token_hash=`
- `GET /auth/set-password` with the token → 200 containing the form
- POST with a 7-character password → 302 back to `/auth/set-password` with the token and an error (token still usable)
- POST with a new valid password → 302 `/dashboard`; the dashboard shows the smoke user's re-delivered meal
- sign out; sign in with the old password → error; sign in with the new password → 302
- re-POST the used token → 302 `/auth/forgot-password?error=`; a made-up token → same
- delivery-created account (`newUserDelivery`'s email) claims itself: recovery token → set password → 302 `/dashboard` showing that delivery's meal
- when `MAILPIT_URL` is set: `POST /api/auth/forgot-password` for the smoke user, read the newest message to that address from Mailpit's API, take the link's path and query (the host is `site_url`), check it is `/auth/set-password?…type=recovery`, post a new password with it → 302 `/dashboard`

Without `MAILPIT_URL` the script prints `SKIP  real reset email (set MAILPIT_URL)`. The invite and garbage-link steps for `/api/auth/confirm` stay.

#### 2. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Let the smoke job read the reset email.

**Contract**: the smoke step passes `MAILPIT_URL` (from `supabase status -o env`, or `http://127.0.0.1:54324`) to `npm run smoke`.

#### 3. README

**File**: `README.md`

**Intent**: Document the new routes, the claim path for MO accounts and the production steps.

**Contract**:
- "Auth routes": add `/auth/forgot-password` and `/auth/set-password`; `/api/auth/confirm` now verifies invitations and forwards reset links to `/auth/set-password`.
- One sentence that, until invitations exist (S-04), "Forgot or never set a password?" is how an account created by a delivery gets its password.
- Production setup for email links: set **Minimum password length** to 8 (Authentication → Providers → Email) after CI is green and before merging; re-paste **Reset password** from `recovery.html` *after* the deploy, because the new link needs the new page while `/api/auth/confirm` keeps forwarding old-style links in the meantime. This replaces the generic "repeat before merging" timing for template changes that move a link to a new page.
- Smoke-test section: describe the new reset steps and `MAILPIT_URL`.

#### 4. Handoff to S-04

**File**: `context/foundation/roadmap.md` (S-04 block only); GitHub issue #8

**Intent**: Tell S-04 what it inherits.

**Contract**: a "Handoff from S-05" line in S-04's block and the same text as a comment on #8:
- add `"invite"` to `setPasswordLinkSchema` and the page's wording map, and point `invite.html` at `/auth/set-password?…&type=invite`;
- then remove the GET `verifyOtp` from `/api/auth/confirm` (forward `invite` like `recovery`);
- invite only accounts still unconfirmed, because a delivery-created account may already have claimed itself via reset;
- the sign-in link wording "Forgot or never set a password?" can become "Forgot password?" once invitations exist.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Smoke passes against the local production preview on :4322 with `MAILPIT_URL` set: `npm run build && npm run preview -- --port 4322`, then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 npm run smoke`
- CI `ci` and `smoke` jobs are green on the PR

#### Manual Verification:

- Before merging: minimum password length set to 8 in the production Supabase dashboard; after the deploy: production **Reset password** template re-pasted from `recovery.html`
- After that: a real production reset email (to a throwaway or your own account) arrives through Resend, links to `/auth/set-password`, and the new password works for sign-in (issue #5 Definition of done)
- S-04 handoff is in the roadmap's S-04 block and on #8

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/lib/set-password.test.ts`: email validation; link-type enum (`recovery` only); 7 vs 8 characters; token fields both-or-neither; GoTrue error-code mapping and fallback.
- `src/lib/auth-link.test.ts`: per-type destination (`invite` → dashboard, `recovery` → set-password page).

### Integration Tests:

- Smoke on the Workers runtime (Phase 3): request form neutrality, forwarding of old links, token survives GET and a rejected password, success signs in, old password fails and new works, used and made-up tokens rejected, delivery-created account claims itself, real Mailpit email end to end.

### Manual Testing Steps:

1. Restart local Supabase (`npx supabase stop && npx supabase start`) so the template and minimum length load.
2. `/auth/signin` → "Forgot or never set a password?" → submit your local user's email → open the Mailpit email → set a password → land on `/dashboard`.
3. Sign out, sign in with the new password; the old one fails.
4. Reopen the same email link and try again → invalid-link message on `/auth/forgot-password`.
5. Deliver to a new email (README walkthrough step 1), reset its password, and check its dashboard.

## Migration Notes

- No database migration.
- Production: set the minimum password length to 8 after CI is green and before merging. Re-paste the **Reset password** template only *after* the deploy: until then the production template still links to `/api/auth/confirm`, which the new code forwards to the page; pasting it earlier would send users to a page the old Worker doesn't have.
- Existing 6–7 character passwords keep working until changed; Supabase checks the minimum only when a password is set.
- Local: the shared Supabase stack must be restarted by the user to pick up `config.toml` and `recovery.html` (its API gateway was stopped when this plan was written).

## References

- Roadmap: `context/foundation/roadmap.md` § S-05 (issue #5), § F-01 handoff, § S-04 (issue #8)
- F-01 plan: `context/archive/2026-10-03-email-link-callback/plan.md`
- Existing callback: `src/pages/api/auth/confirm.ts:10`, `src/lib/auth-link.ts:8`
- Account provisioning: `src/pages/api/mo/deliveries.ts:109`
- Form pattern: `src/components/auth/SignInForm.tsx`, `src/pages/api/auth/signin.ts`
- Smoke email-link steps: `scripts/smoke.mjs:233`, `scripts/smoke.mjs:448`
- Phase sub-issues: #51 (Phase 1), #52 (Phase 2), #53 (Phase 3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Request a reset link

#### Automated

- [x] 1.1 Unit tests pass, including the new `src/lib/set-password.test.ts`: `npm test` — 882a8b6
- [x] 1.2 Lint passes: `npm run lint` — 882a8b6
- [x] 1.3 Type and Astro checks pass: `npx astro check` — 882a8b6
- [x] 1.4 Build succeeds: `npm run build` — 882a8b6

#### Manual

- [x] 1.5 After restarting local Supabase (user), `/auth/signin` shows "Forgot or never set a password?", and submitting the smoke-style email on `/auth/forgot-password` shows the confirmation; the recovery email appears in Mailpit (`http://127.0.0.1:54324`) — 882a8b6
- [x] 1.6 Submitting an email with no account shows the same confirmation and no email arrives in Mailpit — 882a8b6
- [x] 1.7 Signing up locally with a 7-character password is rejected; the form says "Min. 8 characters" — 882a8b6

### Phase 2: Set the new password from the link

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Type and Astro checks pass: `npx astro check`
- [ ] 2.4 Build succeeds: `npm run build`

#### Manual

- [ ] 2.5 After restarting local Supabase (user), the Mailpit reset email links to `/auth/set-password?…&type=recovery`; opening it shows the form, and opening it a second time still shows the form (token not used)
- [ ] 2.6 A 7-character password is rejected with the token kept; an 8+ character password lands on `/dashboard`; signing out and in with the new password works and the old one fails
- [ ] 2.7 Opening the same link after a successful reset and posting a password ends on `/auth/forgot-password` with the invalid-link message
- [ ] 2.8 A delivery-created account (README walkthrough step 1, without step 2's Admin API call) can request a reset, set a password, and sees its delivered week

### Phase 3: Smoke coverage, docs and production hand-off

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Smoke passes against the local production preview on :4322 with `MAILPIT_URL` set: `npm run build && npm run preview -- --port 4322`, then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 npm run smoke`
- [ ] 3.3 CI `ci` and `smoke` jobs are green on the PR

#### Manual

- [ ] 3.4 Before merging: minimum password length set to 8 in the production Supabase dashboard; after the deploy: production **Reset password** template re-pasted from `recovery.html`
- [ ] 3.5 After that: a real production reset email (to a throwaway or your own account) arrives through Resend, links to `/auth/set-password`, and the new password works for sign-in (issue #5 Definition of done)
- [ ] 3.6 S-04 handoff is in the roadmap's S-04 block and on #8
