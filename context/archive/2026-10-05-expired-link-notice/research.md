---
date: 2026-10-05T21:38:14+02:00
researcher: Claude (Opus 5.5) for alan
git_commit: d8a83526a5c33a5b569dafb4e4542cd21e45c07f
branch: expired-link-notice
repository: meal-orchestrator-web
topic: "S-10: can /auth/set-password tell on open that an invite/reset link is expired or used, without using its token?"
tags: [research, auth, set-password, supabase-auth, gotrue, one-time-tokens]
status: complete
last_updated: 2026-10-05
last_updated_note: "Follow-up: link lifetime can be raised to at most 86400 s"
last_updated_by: Claude (Opus 5.5)
---

# Research: Expired link notice on open (S-10)

**Date**: 2026-10-05T21:38:14+02:00
**Researcher**: Claude (Opus 5.5) for alan
**Git Commit**: d8a8352 (working tree: uncommitted S-10 edits in `context/foundation/prd.md`, `context/foundation/roadmap.md`)
**Branch**: expired-link-notice
**Repository**: meal-orchestrator-web

## Research Question

S-10 ([#67](https://github.com/malpiszon/meal-orchestrator-web/issues/67)): a user opening an invitation or password-reset link that has expired or was already used should be told so on the page GET, before typing a password; a valid link still shows the form. The roadmap's open unknown (`context/foundation/roadmap.md:249-250`): how to tell whether a link is still valid without using its single-use token, given Supabase Auth has no such call. The S-05/S-04 rule must hold: the check on open never uses the token or signs anyone in, and the post-time error stays as fallback (`roadmap.md:251`).

## Summary

- **No Supabase Auth endpoint can check a token without using it.** `GET /verify` and `POST /verify` both run `verifyTokenHash` and then use the token, and no admin endpoint looks a user up by token hash (supabase/auth `internal/api/verify.go#L120-L160`, `#L229-L311`; token columns are `json:"-"` in `internal/models/user.go#L40,#L46`, master `ce9a8ee`).
- **A read-only database check that mirrors GoTrue's verify predicate works.** On the inspected GoTrue v2.197.0 (local) and master `ce9a8ee`, `POST /verify` with `token_hash` accepts a link only when both of these hold:
  1. A row exists in `auth.one_time_tokens` with exactly that `token_hash` and the matching `token_type`: `confirmation_token` for `invite`, `recovery_token` for `recovery`.
  2. The user's `confirmation_sent_at` (invite) or `recovery_sent_at` (recovery), plus the mailer OTP lifetime, is still in the future.

  Local probes confirmed every leg of this (table below). A `security definer` SQL function granted only to `service_role`, called from the page through `createServiceClient()`, follows the existing `ingest_weekly_plan` pattern (`supabase/migrations/20261001120000_weekly_plans.sql:67-79,121-124`).

- **The OTP lifetime cannot be read from SQL.** It is a GoTrue setting: `GOTRUE_MAILER_OTP_EXP`, which is `3600` locally from `supabase/config.toml:217` and is the dashboard "Email OTP Expiration" on hosted projects. The code default is 86400 s when unset (`internal/conf/configuration.go#L1229-L1231`). The app must either hard-code or configure it, or check only that the token row exists.
- **Coupling cost.** This reads Supabase-managed internals that Supabase warns "may change at any time" (https://supabase.com/docs/guides/auth/managing-user-data). Upstream is actively changing exactly this table: a new `link_token_hash` column (migration `20260911120000`), `expires_at`, and the experimental `EnableOTTAsSourceOfTruth` flag. A pgTAP test on the function plus the existing smoke steps would catch a local-stack upgrade that breaks it. The post-time `verifyOtp` error remains the safety net either way.

## Detailed Findings

### Current page and route behaviour

- `src/pages/auth/set-password.astro:30-35` only zod-parses `token_hash`/`type` (format check, `src/lib/set-password.ts` `setPasswordLinkSchema`). A well-formed but used or expired token therefore shows the form (`showForm`, `:39`). The "This link is invalid or has expired." text plus "Ask for a new link" (`FORGOT_PASSWORD_PATH`) already exists for the no-token case (`:52`, `:58-64`). S-10 can reuse that branch for a known-dead token.
- The page sets `Cache-Control: no-store` and `Referrer-Policy: strict-origin` (`set-password.astro:15-16`).
- `src/pages/api/auth/set-password.ts:62-68` calls `verifyOtp` only on POST, after password validation. On error it redirects to `/auth/forgot-password?error=This link is invalid or has expired. Ask for a new one.` (`:16`, `:30-31`). This is the fallback S-10 must keep.
- `/api/auth/confirm` (`src/pages/api/auth/confirm.ts:12-19`, forwards via `authLinkRoute`) never verifies. Old-style links reach the page GET, so a check on the page covers them too.
- `context.locals.user` is resolved for every non-`/api/mo/` request (`src/middleware.ts:15-24`). The page has no session for a fresh link click, so a check must not depend on the user's session. Service role is the fit.

### Supabase Auth verify predicate (source)

From supabase/auth master `ce9a8ee` (diffed against v2.197.0 for `verify.go`, `mail.go`, `one_time_token.go`; the token_hash path is the same in both):

- `{{ .TokenHash }}` is the user's stored token column. That value is `hex(sha224(email + otp))` (`internal/crypto/crypto.go#L45-L47`), with a `pkce_` prefix only for recovery under the PKCE flow (`internal/api/pkce.go#L33-L40`). The same bytes go into `auth.one_time_tokens.token_hash` (`internal/api/mail.go#L360-L437`; template `internal/mailer/templatemailer/templatemailer.go#L238,#L343`).
  - This app's reset request uses `createStatelessClient()`, which uses the implicit flow (`src/lib/supabase.ts:37-48`, `src/pages/api/auth/forgot-password.ts:24,31`), so no prefix. Lookup is an exact match either way.
- Lookup: `FindUserByOneTimeToken` runs `token_type = ? and token_hash = ?` on `one_time_tokens`, then loads the user by `user_id` (`internal/models/one_time_token.go#L192-L235,#L255-L262`). If no row matches, verify answers 403 `otp_expired`.
- Expiry: `isOtpExpired` is `now > sentAt + Mailer.OtpExp` (`verify.go#L796-L798`), with `sentAt = confirmation_sent_at` for invite/signup (not `invited_at`) and `recovery_sent_at` for recovery. `one_time_tokens.expires_at` is not read on this path.
- Other verify rejections: a banned user gets 403 `user_banned`. This is optional for the check: a banned user still lands on the POST error.
- After use:
  - `user.Confirm` (invite) and `user.Recover` (recovery) delete **all** of the user's `one_time_tokens` rows (`internal/models/user.go#L524-L544,#L659-L666`). Using one link therefore also kills the user's other pending link.
  - On a recovery verify, `users.confirmation_token` is not cleared. That does not matter, since lookup uses `one_time_tokens`.
- A new link of the same type replaces the old one: `CreateOneTimeToken` deletes the user's existing row of that type before inserting (`one_time_token.go#L144-L153`). If sending the email fails, the old token survives.

### Local confirmation (GoTrue v2.197.0, `supabase/.temp/gotrue-version`)

Probes used Admin `generate_link`, `POST /auth/v1/verify` and `psql` in `supabase_db_mo-web`. The test users were deleted afterwards.

| Probe                                                                   | Result                                   |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| recovery link: `users.recovery_token = one_time_tokens.token_hash`      | true; `token_type = recovery_token`      |
| `encode(sha224(email \|\| otp),'hex') = hashed_token`                   | true                                     |
| invite link: stored `token_type`                                        | `confirmation_token`; `expires_at` null  |
| recovery link: `expires_at`                                             | null                                     |
| second recovery link generated: rows for first / second hash            | 0 / 1; first hash verify → `otp_expired` |
| successful recovery verify: user's remaining OTT rows; `recovery_token` | 0; `''`                                  |
| reuse of used hash; garbage hash `deadbeef`                             | both 403 `otp_expired`                   |
| `recovery_sent_at` backdated 61 min                                     | `otp_expired`                            |
| invite `confirmation_sent_at` backdated 61 min / then 59 min            | `otp_expired` / ok                       |
| OTT row deleted, `users.recovery_token` kept                            | `otp_expired` (row is the truth)         |
| `users.recovery_token` cleared, OTT row kept                            | ok                                       |
| recovery hash verified as `type=invite`                                 | `otp_expired` (type must match)          |
| invite verify after `email_confirmed_at` set (row still present)        | ok (no "already confirmed" check)        |
| `GOTRUE_MAILER_OTP_EXP` in auth container                               | `3600`                                   |
| `postgres` SELECT on `auth.users` / `auth.one_time_tokens`              | true / true                              |
| `service_role` SELECT on `auth.users`; `authenticated` on OTT           | false / false                            |

GoTrue returns the same `otp_expired` code for expired, used, superseded and made-up tokens. "Invalid or has expired" is therefore the only message a check can honestly give, which matches the existing copy.

### Hosted Supabase access

- The auth migration `20240612123726_enable_rls_update_grants.up.sql` grants `select … to postgres with grant option` on the auth tables. supabase/postgres demotes `postgres` to `NOSUPERUSER … BYPASSRLS` (`migrations/db/migrations/10000000000000_demote-postgres.sql#L22`). A `security definer` function owned by `postgres` can therefore read `auth.one_time_tokens` despite RLS (worker source read; not tested on the live hosted project).
- Precedent in this repo: `ingest_weekly_plan` is `security definer`, `set search_path = ''`, reads `auth.users`, and has execute revoked from `public, anon, authenticated` and granted to `service_role` (`supabase/migrations/20261001120000_weekly_plans.sql:67-79,121-124`). It is called via `createServiceClient()` (`src/lib/supabase.ts:28-35`; `src/pages/api/mo/deliveries.ts:56`).
- `createServiceClient()`'s doc says "never use it in a user-facing code path" (`src/lib/supabase.ts:25-27`). Calling a narrow read-only RPC from the page conflicts with that wording. The plan must either amend the comment or grant the function to `anon` and call it with the page's own client. The function returns a boolean for a 224-bit hash, so it gives no useful oracle.

## Code References

- `src/pages/auth/set-password.astro:30-41` - link parse, `showForm`, invalid-link branch
- `src/pages/api/auth/set-password.ts:16,30-31,62-68` - POST-time `verifyOtp` and the invalid-link fallback
- `src/pages/api/auth/confirm.ts:12-19` - forwards old-style links to the page without verifying
- `src/lib/set-password.ts` - `setPasswordLinkSchema`, `SET_PASSWORD_LINK_TYPES = ["recovery","invite"]`
- `src/lib/supabase.ts:25-48` - `createServiceClient` (with "never user-facing" note), `createStatelessClient` (implicit flow)
- `supabase/migrations/20261001120000_weekly_plans.sql:67-79,121-124` - security definer + service_role grant pattern reading `auth.users`
- `supabase/config.toml:217` - `otp_expiry = 3600` (local only)
- `scripts/smoke.mjs:310-312,621-628,651-660` - page GET shows form; token survives GET (regression guard)
- `scripts/smoke.mjs:557-586` - invite link open must not sign anyone in
- `scripts/smoke.mjs:668-678` - asserts substring "This link is invalid or has expired" on token-less GET
- `scripts/smoke.mjs:705-718,835-838` - POST-only rejection of used/made-up tokens (no GET step today)
- `src/lib/set-password.test.ts:33-52`, `src/lib/auth-link.test.ts:29-35` - format-only tests; nothing covers validity

## Architecture Insights

- The check is a read-only mirror of `verifyTokenHash`'s first two steps. It must never call GoTrue's verify and never create a session. The DB approach satisfies that by construction.
- False negatives and false positives in the check fail differently:
  - "Valid" for a dead link is today's behaviour: the POST fallback catches it.
  - "Invalid" for a live link locks the user out of that link. They can still ask for a new one.

  A planner should therefore bias the check towards "valid" when unsure. Examples: the RPC errors, the service key is missing, or a hard-coded lifetime is shorter than the production setting.

- The lifetime has three options: hard-code `3600`, read it from a new env var/secret, or skip the time check (row-exists only). The README's production setup section is where a dashboard-value dependency would be documented (`README.md`, "Production setup for email links").

## Historical Context (from prior changes)

- `context/archive/2026-10-03-email-link-callback/plan.md:42` - F-01 originally verified on GET in `/api/auth/confirm`. Its reviews flagged mail-scanner prefetch burning the token (`reviews/impl-review-phase-1.md:27-43`) and login CSRF (`reviews/impl-review.md:43-51`), and handed both to S-04/S-05 (`follow-ups/review-fixes.md:5`). **Supported, still binding.**
- `context/archive/2026-10-04-password-reset/plan.md:5,10,23,149-156` - S-05 rule: "The page never calls `verifyOtp`"; opening a link uses nothing. `plan.md:14,36`: `checkOrigin: true` is the CSRF guard for POST-only verify. **Supported.** S-10 keeps the letter of the rule (no `verifyOtp` on GET).
- `context/archive/2026-10-04-password-reset/reviews/impl-review-phase-3.md:52-54` - "a used-but-well-formed token still shows the form (by design: the token is not checked on GET)". **Accurate for current code; S-10 deliberately supersedes this behaviour.**
- `context/archive/2026-10-04-invite-on-first-delivery/plan-brief.md:24`, `plan.md:11,64-66,217` - invites reuse the page with POST-only verify. **Supported.**
- None of the inspected archives considered a non-consuming validity check or reading `auth.*` token tables (worker grep over the three archives; plans, briefs and reviews read in excerpts).

## Related Research

Not applicable: none of the three archives above has a `research.md`.

## Open Questions

1. **Lifetime source**: hard-code 3600, configure via env, or skip the time check? The production dashboard's "Email OTP Expiration" value is not verified (no hosted access in this research).
2. **Calling identity**: service-role RPC (contradicts the `createServiceClient` comment) or an `anon`-granted function called with the page's client?
3. **Fail-open on check errors**: recommended, so the page shows the form as today. This needs confirming as the planned behaviour.
4. **Upgrade guard**: pgTAP test of the function against local GoTrue's real token rows (generated via `auth.admin`/SQL inserts), plus new smoke GET steps for a used token, a garbage token and a valid token that still survives.
5. **Hosted grants on `auth.one_time_tokens`**: inferred from source, not tested live. The first `db push` plus the post-deploy smoke would reveal a failure. The design should fail open on it.

## Follow-up 2026-10-05: can the 60-minute link lifetime be increased?

- Yes, up to 24 hours. Hosted projects set it in Auth → Providers → Email → **Email OTP Expiration**, and Supabase disallows values above 86400 seconds (one day) to guard against brute force ([passwordless email docs](https://supabase.com/docs/guides/auth/auth-email-passwordless)). The local equivalent is `supabase/config.toml:217` (`otp_expiry`, default 3600).
- One setting covers invitation and reset links (and email OTP codes); there is no separate invite lifetime ([supabase discussion #23444](https://github.com/orgs/supabase/discussions/23444)). This matches the verify source above: one `Mailer.OtpExp` for every email type (`verify.go#L796-L798`).
- Trade-offs:
  - the not-yet-used token in Cloudflare request logs (README "Known risk", `README.md:170`) would stay usable for the longer window;
  - the email's 6-digit OTP code, which GoTrue also accepts with the email address, stays guessable for longer (the reason for the cap).
- Effect on S-10: the lifetime question (Open Question 1) gets a hard upper bound of 86400 s. A hard-coded app value must equal the production setting. Coding 86400 as the upper bound would fail open: links older than the real lifetime would still show the form, and the POST fallback would catch them.
