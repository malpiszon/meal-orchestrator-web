# Email-link Callback — Plan Brief

> Full plan: `context/changes/email-link-callback/plan.md`

## What & Why

Supabase invitation and password-reset emails must turn into a signed-in mo-web session; today their links dead-end on `/?code=…`. This foundation (roadmap F-01, issue #2) adds the callback both S-04 (invitation) and S-05 (password reset) depend on.

## Starting Point

No route reads email links. The SSR client uses PKCE, which can't serve server-sent invitations (no code verifier exists, so tokens arrive in a `#fragment` the server never sees) or reset links opened on another device. Email templates are stock, and local `site_url` points at the wrong port.

## Desired End State

Clicking an invite or reset link, locally (Mailpit) or in production, signs the user in and lands them on `/dashboard`. A bad or expired link lands on `/auth/signin` with a readable error. CI's smoke test proves both link types on the Workers runtime, and a real production invitation has been re-tested.

## Key Decisions Made

| Decision            | Choice                                                                  | Why (1 sentence)                                                                                                    |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Link mechanism      | token_hash templates + server-side `verifyOtp` at `/api/auth/confirm`   | Works for admin-sent invites and on any device; PKCE `exchangeCodeForSession` can't handle server-sent invitations. |
| Production template | Set once by hand in the Supabase dashboard, before merge                | One-time step (repeated only if the template changes); `supabase config push` would also push local values.         |
| Destination         | `/dashboard` for both invite and recovery                               | Smallest F-01; S-04/S-05 switch it to their own set-password pages.                                                 |
| Accepted link types | `invite` and `recovery` only, fixed destinations, no `?next=`           | No open-redirect surface; other types aren't needed yet.                                                            |
| Bad link            | Redirect to `/auth/signin?error=<friendly text>`, raw cause only logged | Reuses the existing error display; no new UI.                                                                       |
| Verification        | Smoke via Admin `generate_link` + production dashboard invite re-test   | Automated in CI without Mailpit, plus the real-email check the risk register requires.                              |

## Scope

**In scope:**

- `GET /api/auth/confirm` + zod query schema with unit tests
- `supabase/templates/{invite,recovery}.html`, wired in `config.toml`; local `site_url` → `http://localhost:4321`
- Smoke steps (invite, recovery, bad link) and the service-role key passed to them in CI
- README (route, local try-out, production one-time step), infrastructure.md follow-up, S-04/S-05 handoff in F-01's roadmap block and on issues #8 and #5

**Out of scope:**

- Set-password page, sending invitations (S-04), reset request form (S-05)
- PKCE `/auth/callback?code=` route, `?next=` parameter
- Sign-up confirmation template; dedicated "link expired" page; self-service resend
- Automating production auth config

## Architecture / Approach

Email link → `{{ .SiteURL }}/api/auth/confirm?token_hash=…&type=invite|recovery` → zod validation → `verifyOtp` on the cookie-bound SSR client (writes session cookies) → 302 `/dashboard`. Any failure → 302 `/auth/signin?error=…`. Middleware is unchanged: the next request's `getUser()` picks up the new cookies.

## Phases at a Glance

| Phase                                        | What it delivers                                                  | Key risk                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Confirm route and local templates         | Working link → session flow against local Supabase + Mailpit      | Shared local Supabase: only the user restarts it, so template wiring is checked late (row 1.6) |
| 2. Smoke coverage in CI                      | Invite, recovery and bad-link steps proven on the Workers runtime | Single cookie jar in smoke: the jar must be cleared between users                              |
| 3. Production configuration and verification | Production templates set, real invite re-tested, docs and handoff | Forgetting the dashboard template step leaves production links broken                          |

**Prerequisites:** none (F-01 has no roadmap prerequisites); Supabase dashboard access for Phase 3.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Production templates are a manual step; if skipped, links keep going through `/auth/v1/verify` to `/?code=…` as today.
- Until S-04/S-05 ship, an invited user is signed in once but has no password to log in with again.
- Token_hash links always use `{{ .SiteURL }}` (production), so invites and resets can't be tested on `*.workers.dev` preview versions.

## Success Criteria (Summary)

- A real production invitation link signs the recipient in and shows their dashboard.
- Expired or reused links show a clear message on the sign-in page instead of failing silently.
- CI proves invite and recovery links produce a session for the right user.
