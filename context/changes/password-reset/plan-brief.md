# Password reset — Plan Brief

> Full plan: `context/changes/password-reset/plan.md`

## What & Why

A user who forgot their password, or never set one, asks for a reset link by email, chooses a new password and is signed in (roadmap S-05, issue #5; FR-005, US-04). The emailed token must be used only when the form is posted, not when the link is opened, so link-prefetching mail scanners can't burn it and no site can sign a victim in as an attacker (F-01's handoff).

## Starting Point

F-01's `GET /api/auth/confirm` verifies reset links on the GET and forwards to `/dashboard`; there is no request form, no new-password page and no link from sign-in. MO deliveries create unconfirmed accounts with no password, which nobody can sign in to until S-04's invitations exist.

## Desired End State

`/auth/signin` links to "Forgot or never set a password?". Submitting an email always shows the same confirmation. The email opens `/auth/set-password`, which uses nothing until the user posts an 8+ character password; then they land signed in on `/dashboard`, and only the new password works afterwards. Delivery-created accounts can claim themselves this way. CI proves it all, including a real email read from Mailpit.

## Key Decisions Made

| Decision            | Choice                                                                            | Why (1 sentence)                                                                                       |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Link routing        | Template → new page; `/api/auth/confirm` forwards `recovery` links unverified     | No GET ever uses a reset token, and the deploy and the production template paste can happen in any order. |
| Reuse by S-04       | One `/auth/set-password` page + route keyed by link type; only `recovery` for now | S-04 adds `invite` to an enum and a wording map instead of duplicating the token-on-POST logic.       |
| After success       | Stay signed in, redirect to `/dashboard`                                          | Verifying the token already creates the session; one step fewer for the user.                          |
| Request feedback    | Same message for every email; errors only for rate limit / Supabase failure       | Doesn't reveal which emails are MO users.                                                              |
| Password field      | One field with show/hide toggle; minimum raised to 8 locally and in production    | Supabase's recommendation; the toggle covers typos without a second field.                             |
| MO-created accounts | Allowed to claim themselves via reset; link reads "Forgot or never set a password?" | Same mailbox proof as an invitation, and gives real users a way in before S-04.                        |
| Rejected password   | Check length before `verifyOtp`; after it, retry on the session without the token | A used token must never strand the user.                                                               |

## Scope

**In scope:**
- Request page + route, sign-in link, shared rules module with unit tests, cookie-less anon client
- New-password page + route, recovery template, `/api/auth/confirm` forwarding, 8-character minimum (also on the sign-up form)
- Smoke steps (incl. Mailpit and a delivery-created account), CI `MAILPIT_URL`, README, S-04 handoff on #8 and in the roadmap

**Out of scope:**
- Invitations and the `invite` type (S-04); change-password for signed-in users; MFA (FR-006)
- "No such account" messages; blocking resets for delivery-created accounts; a confirm-password field
- Landing/auth page restyle (S-09); removing public sign-up (S-04)

## Architecture / Approach

`/auth/forgot-password` → `POST /api/auth/forgot-password` → `resetPasswordForEmail` on a cookie-less anon client (implicit flow, so the link works in any browser) → email → `/auth/set-password?token_hash=…&type=recovery` (renders a form with hidden token fields; `no-store`, `no-referrer`) → `POST /api/auth/set-password`: check length → `verifyOtp` on the cookie-bound SSR client (sets session) → `updateUser({ password })` → 302 `/dashboard`. Cross-site posts are blocked by Astro's `checkOrigin`.

## Phases at a Glance

| Phase                                         | What it delivers                                                    | Key risk                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Request a reset link                       | Sign-in link, request form + route, shared rules, 8-char minimum    | Local stack must be restarted (by you) to pick up `config.toml`              |
| 2. Set the new password from the link         | New-password page + route, template, `/api/auth/confirm` forwarding | Wrong order (verify before length check) would burn tokens on typos          |
| 3. Smoke coverage, docs and production hand-off | CI proof incl. Mailpit, README, production steps, S-04 handoff      | Production template pasted before the deploy would link to a missing page    |

**Prerequisites:** F-01 (done); local Supabase restarted with its API gateway up (it was stopped while planning).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- GoTrue sending recovery emails to unconfirmed, passwordless accounts and confirming them on verify is from GoTrue's behaviour, not tested locally (gateway down); the smoke step for a delivery-created account checks it in CI.
- Existing 6–7 character passwords keep working until changed.
- Production timing: minimum length before merging; recovery template only after the deploy.

## Success Criteria (Summary)

- A user resets a forgotten password from a real production email and signs in with the new one.
- Opening a reset link (by a person or a scanner) never uses the token; only the form post does.
- A delivery-created account can set its first password through the same flow and sees its own plan.
