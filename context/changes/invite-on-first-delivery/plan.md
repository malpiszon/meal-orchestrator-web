# Invite on first delivery Implementation Plan

## Overview

When MO's first delivery for an email creates a mo-web account, that email now receives an invitation. The link opens the shared set-password page (built in S-05), the user chooses a password and lands signed in on `/dashboard` (roadmap S-04, issue #8; FR-002, FR-003, FR-004, US-02, US-03). The invitation token is used only when the password form is posted, so mail scanners and login-CSRF can't burn or abuse it. The public sign-up path is removed, so an invitation is the only way to get an account.

## Current State Analysis

- `POST /api/mo/deliveries` calls the `ingest_weekly_plan` RPC; on `unknown_user` it calls `admin.createUser({ email_confirm: false, app_metadata: { provisioned_by: "mo-delivery" } })` (no email) and retries the RPC (`src/pages/api/mo/deliveries.ts:109`). A failed `createUser` is logged, not fatal, because a concurrent delivery may have created the account.
- The set-password page and route are built to be shared (S-05 handoff): `SET_PASSWORD_LINK_TYPES = ["recovery"]` (`src/lib/set-password.ts:23`), the page's `WORDING` map (`src/pages/auth/set-password.astro:19`), and the `mo-password-retry` cookie gate in `src/pages/api/auth/set-password.ts`.
- `/api/auth/confirm` still verifies `invite` links on the GET (`authLinkRoute`, `src/lib/auth-link.ts:33`), which burns the single-use token on a scanner prefetch. `supabase/templates/invite.html` links to `/api/auth/confirm?…&type=invite`.
- Public sign-up is still live: `src/pages/auth/signup.astro`, `src/pages/api/auth/signup.ts`, `src/components/auth/SignUpForm.tsx`, `src/pages/auth/confirm-email.astro`, links in `Topbar.astro` and `Welcome.astro`; `supabase/config.toml` has `enable_signup = true` (twice, `[auth]` and `[auth.email]`). Production sign-up is already off in the Supabase dashboard (infrastructure.md, 2026-09-24).
- `scripts/smoke.mjs` creates its test user through `/api/auth/signup` and has invite steps that open the link through `/api/auth/confirm`.
- Sign-in shows "Forgot or never set a password?" (`src/components/auth/SignInForm.tsx:90`), which was the stop-gap for delivery-created accounts.

## Desired End State

- A delivery for a new email stores the week, creates the account and sends the invitation. The response is the same 200 `{plan_id, week_start, account_created}`.
- If the invitation email can't be sent, the week and account are still stored, the failure is logged, and MO still gets 200. MO sees nothing new.
- The invitation link opens `/auth/set-password?token_hash=…&type=invite` (no token used on the GET). Posting a valid 8+ character password signs the user in on `/dashboard`.
- `/auth/signup`, `/api/auth/signup` and `/auth/confirm-email` no longer exist; nothing links to them; local Supabase has sign-up disabled.
- Verify: `npm run lint`, `npm test`, `npx astro check`, `npm run build` and `npm run smoke` pass; a real delivery to a new email on local Supabase produces an invitation email in Mailpit whose link sets a password.

### Key Discoveries:

- The Admin API `inviteUserByEmail` both creates the user and sends the email, so it replaces `createUser` on the provisioning path rather than adding a second call.
- Whether GoTrue keeps the user when sending fails is not documented in the repo; the fallback to `createUser` makes the delivery's 200 independent of the answer. Phase 1 verifies the behaviour locally with the `email_sent = 2` rate limit.
- `generateLinkToken("invite", …)` in `scripts/smoke.mjs` already produces invite tokens through the Admin API `generate_link`, so smoke can drive the new page without email delivery.
- Local Supabase allows 2 auth emails per hour (`supabase/config.toml`, `email_sent`), so repeated local deliveries to new emails hit the limit; that is the natural way to exercise the failure path.

## What We're NOT Doing

- No invitation for accounts that already exist. Production has no accounts yet and the dev ones are throwaway (decided by the user); they can be replaced or given a password by hand. No backfill script.
- No re-invite on later deliveries: an invitation goes out only in the delivery that creates the account.
- No `invite_sent` field and no new status in the delivery response; an email failure is a mo-web problem MO can't act on. Failure handling beyond logging is a Parked follow-up (Phase 3).
- No change to the unconfirmed-account model: the invited account stays unconfirmed until the password is set, which confirms it.
- No new tests beyond what the changed code needs; the broader test strengthening is planned separately by the user.
- No change to the production Supabase sign-up setting (already off).

## Implementation Approach

Phase 1 delivers the whole invite loop: send the invitation, accept it on the shared page, drop the GET token use. Phase 2 then removes the public sign-up path and rewires smoke, which depends on the sign-up route today. Phase 3 documents and records the follow-up. The invite email must keep working in production between deploy and template paste, so the production template step is ordered after the deploy (the old template still points at `/api/auth/confirm?…&type=invite`, which the new code forwards to the set-password page, so invitations keep working in between).

## Phase 1: Invite on first delivery, accept on the set-password page

### Overview

The delivery route sends the invitation when it creates the account, and the invitation link goes through the shared set-password page with no token use on the GET.

### Changes Required:

#### 1. Invitation on account creation

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: On `unknown_user`, create the account by inviting it (`supabase.auth.admin.inviteUserByEmail`) instead of `createUser`, keeping `app_metadata.provisioned_by = "mo-delivery"`. If the invite call errors with anything other than "already exists", log it (code and message only, no email) and fall back to `createUser` with the existing options, so the account and the week are still stored and the response is still 200. `account_created` is true whenever the account was created by either call.

**Contract**: Response shape unchanged: 200 `{plan_id, week_start, account_created}`. `inviteUserByEmail` takes the metadata as `data`, which GoTrue stores as `user_metadata`; `provisioned_by` must end up in `app_metadata` as today (set it with `admin.updateUserById` after the invite, or confirm in the local check that the invite path can set it directly). The existing "already exists" handling (`EMAIL_EXISTS_CODES`, concurrent delivery) applies to the invite call too.

#### 2. Invite links use the shared set-password page

**Files**: `src/lib/set-password.ts`, `src/pages/auth/set-password.astro`, `src/lib/auth-link.ts`, `src/pages/api/auth/confirm.ts`

**Intent**: Add `"invite"` to `SET_PASSWORD_LINK_TYPES` and to the page's `WORDING` map (title "Set your password"/description welcoming the new user). `authLinkRoute` then forwards `invite` like `recovery`: unverified, to `/auth/set-password?token_hash=…&type=invite`. `/api/auth/confirm` drops its GET `verifyOtp` branch since no type needs it; `AuthLinkRoute.verify` and `AUTH_LINK_TYPES` become redundant and are simplified accordingly (`/api/auth/confirm` stays as the forwarder for links sent before the template change).

**Contract**: `setPasswordLinkSchema` and `authLinkQuerySchema` accept `invite`; `POST /api/auth/set-password` verifies `{token_hash, type: "invite"}` only on the form POST and keeps the `mo-password-retry` cookie gate unchanged (set only when saving fails right after `verifyOtp`). `authLinkQuerySchema` still rejects other OTP types.

#### 3. Invitation email template

**File**: `supabase/templates/invite.html`

**Intent**: Point the link at `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=invite` and word it as setting a password (the user is not "accepting" anything separately).

**Contract**: Same `{{ .SiteURL }}` construction as `recovery.html`; local Supabase reads templates only at start, so restart it after editing.

#### 4. Unit tests

**Files**: `src/lib/auth-link.test.ts`, `src/lib/set-password.test.ts`

**Intent**: Update the existing cases: `authLinkRoute` forwards an invite to the set-password page without verifying; the set-password link schema and form schema accept `type: "invite"`.

**Contract**: No new test files.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Type and Astro check passes: `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification:

- On local Supabase (after restarting it for the template), a delivery for a new email returns 200 with `account_created: true`, and an invitation email for that address appears in Mailpit
- The invitation link opens the "set your password" page without using the token (reloading the page still shows the form); posting an 8+ character password lands on `/dashboard` showing the delivered week
- A second delivery for the same email sends no second invitation and returns `account_created: false`
- With the local email rate limit exhausted, a delivery for another new email still returns 200 `account_created: true` with the week stored, and the Worker log shows the invite failure

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Remove public sign-up and adapt smoke

### Overview

An invitation is the only way to get an account. Nothing in the app, config or smoke depends on the sign-up path any more.

### Changes Required:

#### 1. Delete the sign-up path

**Files**: `src/pages/auth/signup.astro`, `src/pages/api/auth/signup.ts`, `src/components/auth/SignUpForm.tsx`, `src/pages/auth/confirm-email.astro`; `src/components/Topbar.astro`, `src/components/Welcome.astro`

**Intent**: Remove the four files and the links to `/auth/signup` in the Topbar and Welcome (the legacy-exception files named in CLAUDE.md). Replace each link with nothing or a link to `/auth/signin`, whichever leaves the layout sensible; delete shared form code only if nothing else imports it.

**Contract**: No route answers at `/auth/signup`, `/api/auth/signup` or `/auth/confirm-email`. Update the comment in `src/lib/password-rules.ts` that names sign-up.

#### 2. Disable sign-up locally

**File**: `supabase/config.toml`

**Intent**: Set `enable_signup = false` in `[auth]` and `[auth.email]`, matching production. Admin `inviteUserByEmail` and `createUser` still work with sign-up disabled (confirmed in Phase 2's smoke run).

**Contract**: Local Supabase must be restarted for this to apply.

#### 3. Sign-in wording

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Change "Forgot or never set a password?" to "Forgot password?" now that invitations exist (S-05 handoff item 5).

**Contract**: Link target `/auth/forgot-password` unchanged.

#### 4. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Keep it simple. Replace the "signup creates account" step with creating the smoke user through the Admin API (`createUser` with a password and `email_confirm: true`, service-role key); the key is now required for smoke (CI already sets it) and the script exits early with a clear message without it. Rework the invite steps: the generated invite link, opened through `/api/auth/confirm`, must forward to `/auth/set-password?token_hash=…&type=invite` without signing in, and posting a valid password to `POST /api/auth/set-password` must land on `/dashboard` showing "No upcoming plan yet". Keep the garbage-link step, now expecting the invalid-link result of the set-password flow.

**Contract**: No new dependencies; smoke keeps running against the production preview in CI. Anything beyond this (broader test coverage) is out of scope.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Type and Astro check passes: `npx astro check`
- Production build succeeds: `npm run build`
- Smoke passes against the local preview on port 4322: `BASE_URL=http://localhost:4322 npm run smoke`
- No code references the removed routes: `grep -rn "auth/signup\|api/auth/signup\|confirm-email" src scripts` returns nothing

#### Manual Verification:

- `/auth/signup`, `/api/auth/signup` and `/auth/confirm-email` return 404 in the dev server
- The Topbar, Welcome page and sign-in page render with no dead links
- A direct sign-up attempt against local Supabase is rejected ("Signups not allowed")

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Docs and follow-up

### Overview

README, the MO contract and the foundation docs describe the new behaviour, including the production rollout order, and the email-failure follow-up is recorded.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: Describe the invitation on first delivery (the account is created and invited in one step; a failed email is only logged), the `/auth/set-password` handling of `invite` links, and the removal of sign-up from the auth routes table; fix the dev walkthrough (the invitation replaces the Admin API password step, which stays only as a shortcut for local testing) and the smoke description. Fix the MO contract link, which points to a path that moved to `context/archive/2026-09-30-mo-weekly-delivery/`. Add the production note: paste the **Invite user** template (`supabase/templates/invite.html`, subject unchanged) into the production dashboard only **after the deploy**; until then the old template's link still reaches `/api/auth/confirm`, which forwards invites to the set-password page. Production sign-up is already off.

**Contract**: Doc-only; keep existing section structure.

#### 2. MO delivery contract

**File**: `context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md`

**Intent**: In the 200 row, replace "mo-web invites that user later (mo-web S-04)" with "mo-web sends that user an invitation; a failed email is only logged and doesn't change the response".

**Contract**: No response-shape change.

#### 3. Foundation docs and roadmap follow-up

**Files**: `context/foundation/infrastructure.md`, `context/foundation/roadmap.md`

**Intent**: In infrastructure.md note that the sign-up page and API route were removed (the 2026-09-24 to-do says they "should be removed when FR-003 invitations are built") and that an invitation is verified via the set-password page. In roadmap.md, add a Parked entry "Invite email failure handling" (already added while planning; only verify it) (a failed invitation email is only logged; consider a retry or a visible state once more users join). Roadmap status changes (`in-progress`, `done`) are handled by `/10x-implement` and `/10x-archive`, not here.

**Contract**: Parked items get no GitHub issue until pulled into a milestone (CLAUDE.md).

### Success Criteria:

#### Automated Verification:

- Prettier passes on the edited docs: `npx prettier --check README.md context/foundation/roadmap.md context/foundation/infrastructure.md`
- No stale references to the removed routes: `grep -rn "auth/signup" README.md context/foundation` returns only historical notes that say the routes were removed

#### Manual Verification:

- The README's invitation and rollout text reads correctly end to end, and the contract link opens the file
- The roadmap Parked list contains the invite-failure follow-up

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before closing the change.

---

## Testing Strategy

### Unit Tests:

- `authLinkRoute` forwards `invite` and `recovery` to the set-password page unverified; the query schema still rejects other OTP types.
- Set-password link and form schemas accept `invite`.

### Integration Tests:

- `npm run smoke`: user creation via the Admin API, invite link through the confirm forwarder to the set-password page, password post landing on `/dashboard`, garbage link rejected.

### Manual Testing Steps:

1. Deliver the sample for a new email on local Supabase; read the invitation in Mailpit (`http://127.0.0.1:54324`); open the link, set a password, check the dashboard.
2. Reload the invitation page before posting to confirm the token survives the GET; reuse the link after posting to confirm it is rejected.
3. Exhaust the local email limit, deliver for another new email, confirm 200 and the logged failure.

## Performance Considerations

None. The invite call replaces the existing `createUser` call; it adds one SMTP send inside the delivery request, which only happens on the first delivery per user.

## Migration Notes

- No database migration.
- Production rollout: merge deploys the code (the old production invite template still works through the `/api/auth/confirm` forwarder). Paste the new invite template into the Supabase dashboard after the deploy. No accounts exist in production, so there is nothing to backfill; local dev accounts can be replaced or given a password by hand.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-04, with the "Handoff from S-05"), issue #8
- PRD: `context/foundation/prd.md` (FR-002, FR-003, FR-004, US-02, US-03, Access Control)
- Set-password flow it reuses: `context/archive/2026-10-04-password-reset/plan.md`
- MO contract: `context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md`
- Delivery route: `src/pages/api/mo/deliveries.ts:109`
- Phase sub-issues of #8: Phase 1 #62, Phase 2 #63, Phase 3 #64 (each blocked by the previous one)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Invite on first delivery, accept on the set-password page

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Unit tests pass: `npm test`
- [x] 1.3 Type and Astro check passes: `npx astro check`
- [x] 1.4 Production build succeeds: `npm run build`

#### Manual

- [x] 1.5 On local Supabase (after restarting it for the template), a delivery for a new email returns 200 with `account_created: true`, and an invitation email for that address appears in Mailpit
- [x] 1.6 The invitation link opens the "set your password" page without using the token (reloading the page still shows the form); posting an 8+ character password lands on `/dashboard` showing the delivered week
- [x] 1.7 A second delivery for the same email sends no second invitation and returns `account_created: false`
- [x] 1.8 With the local email rate limit exhausted, a delivery for another new email still returns 200 `account_created: true` with the week stored, and the Worker log shows the invite failure

### Phase 2: Remove public sign-up and adapt smoke

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Unit tests pass: `npm test`
- [ ] 2.3 Type and Astro check passes: `npx astro check`
- [ ] 2.4 Production build succeeds: `npm run build`
- [ ] 2.5 Smoke passes against the local preview on port 4322: `BASE_URL=http://localhost:4322 npm run smoke`
- [ ] 2.6 No code references the removed routes: `grep -rn "auth/signup\|api/auth/signup\|confirm-email" src scripts` returns nothing

#### Manual

- [ ] 2.7 `/auth/signup`, `/api/auth/signup` and `/auth/confirm-email` return 404 in the dev server
- [ ] 2.8 The Topbar, Welcome page and sign-in page render with no dead links
- [ ] 2.9 A direct sign-up attempt against local Supabase is rejected ("Signups not allowed")

### Phase 3: Docs and follow-up

#### Automated

- [ ] 3.1 Prettier passes on the edited docs: `npx prettier --check README.md context/foundation/roadmap.md context/foundation/infrastructure.md`
- [ ] 3.2 No stale references to the removed routes: `grep -rn "auth/signup" README.md context/foundation` returns only historical notes that say the routes were removed

#### Manual

- [ ] 3.3 The README's invitation and rollout text reads correctly end to end, and the contract link opens the file
- [ ] 3.4 The roadmap Parked list contains the invite-failure follow-up
