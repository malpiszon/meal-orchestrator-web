# Expired Link Notice on Open — Plan Brief

> Full plan: `context/changes/expired-link-notice/plan.md`
> Research: `context/changes/expired-link-notice/research.md`

## What & Why

S-10 (#67): a user who opens an invitation or password-reset link that has expired, was already used or was replaced should see "This link is invalid or has expired." straight away, before typing a password, with a way to get a new link. Today they only find out after submitting the form. The S-05/S-04 rule still holds: opening a link must never use its single-use token or sign anyone in.

## Starting Point

`/auth/set-password` only format-checks `token_hash`/`type`, so any well-formed token shows the form. The token is verified only on POST, which redirects a dead link to `/auth/forgot-password` with the error. The page already has an "invalid or has expired" branch for the no-token case. Supabase Auth has no "check without using" call.

## Desired End State

A dead link (used, replaced, made-up or expired) shows the existing notice and "Ask for a new link" on open. A valid link shows the form, and its token is still usable. If the check can't run, the page behaves as today, and the POST error remains the fallback.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| How to check without using the token | Read-only SQL function mirroring GoTrue's verify predicate: token row by hash + type, and `sent_at + lifetime ≥ now()` | Confirmed on local GoTrue v2.197.0; no API exists that doesn't use the token | Research |
| Link lifetime | Stays 1 hour (3600 s), as an app constant passed to the function | No new secret; a unit test pins it to `config.toml`, a README step pins production | Plan |
| Calling identity | Function executable only by `service_role`; page calls it via `createServiceClient()` | Smallest grant; anon never reaches a function reading `auth.*` | Plan |
| When the check fails | Fail open: show the form, log a warning (never the token) | A broken check must never lock out a live link; today's POST error still catches dead ones | Plan (research recommended) |
| Message | One "invalid or has expired" for every dead case | GoTrue itself answers `otp_expired` for all of them | Research |
| Dead token with a retry cookie | Treated as no token → token-less retry form | Avoids a form that posts a dead token | Plan |

## Scope

**In scope:**
- Migration with `auth_link_is_valid` and its pgTAP test
- Lifetime constant with a drift test; fail-open helper with unit tests
- Page wiring, and a narrowed `createServiceClient()` comment
- Smoke GET steps, README (auth routes, production OTP-expiry step, migration timing, coupling note)

**Out of scope:**
- Any verify or session on GET
- POST route changes
- Separate messages per failure
- Banned-user check
- Changing the lifetime
- `expires_at`/`link_token_hash`
- `/api/auth/confirm` changes

## Architecture / Approach

Page GET → `setPasswordLinkSchema` → `isSetPasswordLinkLive(createServiceClient(), link)` → `rpc("auth_link_is_valid", { hash, type, 3600 })`. This is a `security definer` SQL function reading `auth.one_time_tokens` joined to `auth.users`. `false` means the page treats the link as absent and renders the existing invalid-link branch. Any error or a missing client means `true`, plus a warning.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database link check | `auth_link_is_valid` function + pgTAP (types, expiry, grants) | Mirrors Supabase internals that can change on upgrade |
| 2. Page shows the notice on open | Constant + drift test, fail-open helper + unit tests, page wiring | A wrong "invalid" would lock out a live link (mitigated by failing open) |
| 3. Smoke, README and production | Real-GoTrue smoke steps, docs, production push + dashboard check | Hosted `postgres` grants on `auth.one_time_tokens` are inferred from source, not tested live |

**Prerequisites:** S-04 and S-05 (done); local Supabase running; production access for `db push` and the dashboard.
**Estimated effort:** ~1–2 sessions across 3 small phases.

## Open Risks & Assumptions

- Production "Email OTP Expiration" is assumed to be (and is set to) 3600. If it is longer, live links between 1 h and that value show the notice (README step guards this).
- Hosted `postgres` can read `auth.one_time_tokens` (from source, untested). If not, `db push` fails before the merge; at runtime the page fails open.
- A Supabase Auth upgrade that changes token storage breaks the check. pgTAP and smoke catch it on the local stack, and the page fails open only if the function errors (a silent "false" would show up as smoke failures on valid links).

## Success Criteria (Summary)

- Opening a used or expired invite or reset link shows the notice before any password is typed.
- Opening a valid link shows the form, and the token still works on submit.
- A real expired reset link in production shows the notice.
