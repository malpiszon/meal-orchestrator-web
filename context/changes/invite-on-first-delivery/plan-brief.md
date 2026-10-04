# Invite on first delivery — Plan Brief

> Full plan: `context/changes/invite-on-first-delivery/plan.md`

## What & Why

When MO's first delivery for an email creates a mo-web account, that user gets an invitation email, sets a password on the shared set-password page and lands on their dashboard (roadmap S-04, #8; FR-003, US-02, US-03). Today delivery-created accounts get no email, so the only way in is the "Forgot or never set a password?" workaround, and the public sign-up path still exists.

## Starting Point

The delivery route creates the account with `createUser` and sends nothing. The S-05 set-password page and route are built to take `invite` links but only accept `recovery`; `/api/auth/confirm` still uses the invite token on the GET. Sign-up pages, route and smoke setup are still live.

## Desired End State

A delivery for a new email stores the week, creates the account and sends an invitation; the link opens the set-password page and the password post signs the user in. If the email fails, the week is still stored and MO still gets 200. Sign-up no longer exists anywhere.

## Key Decisions Made

| Decision                    | Choice                                                                               | Why (1 sentence)                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| When to invite              | Only in the delivery that creates the account                                        | One email per person; user's call.                                                    |
| Existing accounts           | No backfill, no script                                                               | Production has none and dev accounts are throwaway; the user can replace them.        |
| Invitation email failure    | Log only, fall back to `createUser`, still 200, no new response field                | MO can't act on a mo-web mail problem; fine for 2–4 users; follow-up Parked.          |
| Invite link handling        | Reuse set-password page; token used only on the POST; drop GET `verifyOtp`           | Closes the scanner-prefetch and login-CSRF gaps F-01 handed over.                     |
| Smoke test user             | Admin API `createUser` with a password; smoke requires the service-role key          | Simplest change now; broader tests are the user's next-week work.                     |
| Sign-in link wording        | "Forgot password?"                                                                   | Invitations now cover the "never set" case.                                           |

## Scope

**In scope:** invite on account creation; `invite` through set-password; template; sign-up removal (pages, API, form, links, local config); smoke adaptation; README, contract and foundation docs; Parked follow-up.

**Out of scope:** backfill for existing accounts; re-invites on later deliveries; `invite_sent` response field; extra tests beyond changed code; production Supabase sign-up setting (already off).

## Architecture / Approach

`POST /api/mo/deliveries` → `ingest_weekly_plan` → on `unknown_user`: `inviteUserByEmail` (on failure log and `createUser`) → retry ingest. Invite email → `/auth/set-password?token_hash=…&type=invite` → form POST verifies the token, sets the password, redirects to `/dashboard`. Old links to `/api/auth/confirm` are forwarded unverified to the same page.

## Phases at a Glance

| Phase                                 | What it delivers                                                         | Key risk                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1. Invite + set-password for invites  | Invitation on creation, invite link through the shared page, tests       | `provisioned_by` must stay in `app_metadata`; GoTrue behaviour on failed mail |
| 2. Remove sign-up, adapt smoke        | No sign-up routes/links, sign-up off locally, smoke on Admin API user    | Smoke breakage in CI                                                     |
| 3. Docs and follow-up                 | README, contract, foundation docs, Parked follow-up                      | Production template pasted before the deploy (README states the order)   |

**Prerequisites:** S-01 and F-01 (done), S-05 (done); local Supabase running.
**Estimated effort:** ~2 sessions across 3 small phases.

## Open Risks & Assumptions

- Assumes `inviteUserByEmail` can set `app_metadata` (or a follow-up `updateUserById` can); verified in Phase 1.
- Local email limit is 2/hour, so manual checks of the invite flow need spacing or a Supabase restart.
- The production **Invite user** template must be pasted only after the deploy; between the two, old links still work through the forwarder.

## Success Criteria (Summary)

- A new MO user receives an invitation on their first delivery, sets a password and sees their plan.
- An email failure never loses a delivery or changes what MO sees.
- No sign-up path remains; lint, tests, build and smoke pass.
