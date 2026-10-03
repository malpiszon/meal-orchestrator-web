# Email-link Callback Implementation Plan

## Overview

Links in Supabase invitation and password-reset emails must turn into a signed-in mo-web session (roadmap F-01, issue #2). This plan adds `GET /api/auth/confirm`, which verifies the email's `token_hash` with `verifyOtp`, sets the session cookies and forwards the user to `/dashboard`. It also points the invite and recovery email templates at that route, locally (committed) and in production (one-time dashboard step). S-04 (invitation) and S-05 (password reset) build on it.

## Current State Analysis

- No route reads email links. Production emails go through `…supabase.co/auth/v1/verify` and land on `/?code=…`, where nothing exchanges the code (`context/foundation/infrastructure.md:117`).
- `@supabase/ssr`'s server client uses the PKCE flow (`node_modules/@supabase/ssr/dist/main/createServerClient.js:37`). PKCE keeps a code verifier in the browser that requested the email. Invitations will be sent server-side with the admin client (S-04), so no verifier exists and GoTrue falls back to implicit tokens in the URL `#fragment`, which never reaches the server. A reset link opened on a different device would fail for the same reason. That rules out the `exchangeCodeForSession` approach the infrastructure note proposed.
- Supabase's documented SSR pattern instead links emails to the app with `token_hash` + `type` and verifies them server-side with `verifyOtp`. This works for any initiator and on any device, and it doesn't depend on `redirect_to` or the redirect allowlist.
- Auth routes follow one shape (`src/pages/api/auth/signin.ts`): build the SSR client with `createClient(context.request.headers, context.cookies)`, redirect to `/auth/<page>?error=<encoded message>` on failure. `/auth/signin` already renders `?error=` (`src/pages/auth/signin.astro:5`).
- Local Supabase: `supabase/config.toml:154` has `site_url = "http://127.0.0.1:3000"`, but the app runs on `http://localhost:4321` (dev and CI). Email templates are not customised (`config.toml:229-232` commented out). Mailpit captures local emails; CI starts Supabase without Mailpit (`.github/workflows/ci.yml:52`).
- `scripts/smoke.mjs` is a zero-dependency step runner with a single cookie jar (`scripts/smoke.mjs:10-41`); CI runs it against the production preview on :4321 (`ci.yml:63-68`).

## Desired End State

- Clicking an invitation or password-reset email link (local Mailpit or production) signs the user in and lands them on `/dashboard`.
- An expired, used or malformed link lands on `/auth/signin` with a readable error.
- The smoke test proves both link types and the bad-link path on the Workers runtime in CI.
- Production's Invite and Reset-password templates point at `/api/auth/confirm`; a real dashboard invitation to a throwaway address has been re-tested in production.

### Key Discoveries:

- `src/pages/api/auth/signin.ts:4-20` — route pattern to mirror (SSR client, `context.redirect`, encoded `error`).
- `src/middleware.ts:4` — only `/dashboard` is protected; `/api/auth/confirm` needs no middleware change, and the cookies it sets are picked up by the next request's `getUser()`.
- `supabase/config.toml:229-232` — template override shape (`[auth.email.template.<name>]` with `subject` + `content_path`).
- `scripts/smoke.mjs:160-174` — pattern for direct Supabase REST calls from the smoke script, gated on env vars.

## What We're NOT Doing

- No set-password page. The callback forwards invite and recovery alike to `/dashboard`; S-04 and S-05 change the destination to their own pages. Until then an invited user is signed in once but has no password.
- No `?next=` parameter. Destinations are fixed server-side, so there's no open-redirect surface.
- No PKCE `/auth/callback?code=` route.
- No sending of invitations (S-04) and no reset request form (S-05).
- No changes to the sign-up confirmation template; sign-up confirmation works today and sign-up itself is removed in S-04.
- No dedicated "link expired" page and no self-service resend.
- No automation of production auth config (`supabase config push` would also push local values such as `site_url`); the production templates are set by hand once.

## Implementation Approach

Email templates build the link as `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=<invite|recovery>`. The route validates the query with zod, accepts only `invite` and `recovery`, calls `supabase.auth.verifyOtp({ token_hash, type })` with the cookie-bound SSR client (which writes the session cookies), and redirects to `/dashboard`. Any validation or verification failure redirects to `/auth/signin?error=<friendly text>`. The raw GoTrue message is only logged, never shown.

## Phase 1: Confirm route and local templates

### Overview

Add the route, its query schema, the two email templates and the local Supabase config, so the flow works end to end against local Supabase + Mailpit.

### Changes Required:

#### 1. Email-link query schema

**File**: `src/lib/auth-link.ts` (new), `src/lib/auth-link.test.ts` (new)

**Intent**: Keep the parsing rule (which link types are accepted, what a valid `token_hash` is) in a pure, unit-tested module, as `mo-delivery.ts` does for the delivery payload.

**Contract**: exports a zod schema for `{ token_hash: non-empty string, type: "invite" | "recovery" }`, plus the post-verification destination (`/dashboard`) as a named constant, so S-04/S-05 have one place to change. Tests cover: both valid types parse; missing/empty `token_hash`, missing `type`, and other OTP types (`signup`, `magiclink`, `email_change`, `email`) are rejected.

#### 2. Confirm endpoint

**File**: `src/pages/api/auth/confirm.ts` (new)

**Intent**: Turn an email link into a session and forward the user, following the existing auth-route pattern.

**Contract**: `export const prerender = false`; `export const GET: APIRoute`. Parses `context.url.searchParams` with the schema. Missing Supabase config → `/auth/signin?error=Supabase is not configured` (as signin does). Invalid query or `verifyOtp` error → `console.error` the cause, redirect to `/auth/signin?error=` with a single friendly message (e.g. "This link is invalid or has expired. Ask for a new one."). Success → redirect to the destination constant.

#### 3. Email templates

**File**: `supabase/templates/invite.html`, `supabase/templates/recovery.html` (new)

**Intent**: Point the two emails at the confirm route instead of `{{ .ConfirmationURL }}`. These files are also the copy-paste source for the production dashboard step in Phase 3.

**Contract**: each contains a short message and a link to `{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (respectively `type=recovery`). No `{{ .ConfirmationURL }}` and no `{{ .RedirectTo }}`.

#### 4. Local Supabase config

**File**: `supabase/config.toml`

**Intent**: Apply the templates locally and make `{{ .SiteURL }}` match where the app actually runs.

**Contract**: `site_url = "http://localhost:4321"` (the user's dev server); add `[auth.email.template.invite]` and `[auth.email.template.recovery]` with a `subject` and `content_path = "./supabase/templates/<name>.html"`. `additional_redirect_urls` stays as is (token_hash links don't use `redirect_to`). Changes take effect only when the stack is restarted from a checkout that has them. The local stack is shared with the parallel S-03 worktree, so the agent never runs `supabase stop`/`start`/`db reset`; the restart is the user's call (row 1.6).

#### 5. README

**File**: `README.md`

**Intent**: Document the new route and how to try it locally.

**Contract**: add `/api/auth/confirm` to the "Auth routes" table; a short note that invite/recovery templates live in `supabase/templates/` and need a Supabase restart after changes, and that local emails are in Mailpit (`http://127.0.0.1:54324`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check and build pass: `npx astro check && npm run build`

#### Manual Verification:

- The agent builds and serves the preview on :4322 (`npx astro preview status` first; never stop another session's preview), generates an invite token for a fresh email through the local Admin API (`generate_link`), and hands the user `http://localhost:4322/api/auth/confirm?token_hash=…&type=invite`; opening it lands on `/dashboard` signed in as that user. Note: localhost cookies ignore the port, so this replaces the user's session on the :4321 dev server too.
- Opening the same link a second time lands on `/auth/signin` with the friendly error
- User-owned, at a moment that suits the parallel S-03 session: restart local Supabase from this worktree (`npx supabase stop && npx supabase start`, data is kept). It starts cleanly, and a Studio invite (Authentication → Users → Invite) produces a Mailpit email (`http://127.0.0.1:54324`) whose link points to `http://localhost:4321/api/auth/confirm?token_hash=…&type=invite`. Checks the committed template wiring, since a bad `content_path` would stop the shared stack from starting.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Smoke coverage in CI

### Overview

Prove both link types and the bad-link path over HTTP on the Workers runtime, without Mailpit, by generating link tokens through the Admin API.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Exercise `/api/auth/confirm` exactly as an email click would, and show that the session belongs to the right user.

**Contract**: a helper that calls `POST {SUPABASE_URL}/auth/v1/admin/generate_link` with the service-role key (`apikey` + bearer) and returns the `hashed_token`. New steps, run after the existing dashboard steps and gated on `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (like the anon-RPC check):

- clear the cookie jar, invite a fresh email (`type: "invite"`), `GET /api/auth/confirm?token_hash=…&type=invite` → 302 to `/dashboard`; `GET /dashboard` → 200 with "No upcoming plan yet" (a new user has no plan)
- clear the jar, recovery link for the smoke user (`type: "recovery"`) → 302 to `/dashboard`; `GET /dashboard` → 200 showing a meal from the smoke user's delivered plan (proves it is that user's session)
- reusing the recovery token, or a garbage `token_hash` → 302 to `/auth/signin?error=`

#### 2. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Give the smoke script the service-role key the local Supabase stack already exposes.

**Contract**: the "Run smoke test against production preview" step passes `SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"` to `npm run smoke`, alongside the existing `SUPABASE_URL`/`SUPABASE_KEY`.

#### 3. README

**File**: `README.md`

**Intent**: Keep the "Smoke test" section accurate.

**Contract**: mention `SUPABASE_SERVICE_ROLE_KEY` as the optional env var enabling the email-link steps, and describe what they check.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Smoke passes locally against the preview on :4322 only (the user's dev server is on 4321, the S-03 session uses 4323), email-link steps included. Before a rebuild, `npx astro preview stop` then `npx astro preview status` to make sure the other session's preview is still up. `npm run build && npm run preview -- --port 4322`, then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run smoke`
- CI `ci` and `smoke` jobs are green on the PR

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Production configuration and verification

### Overview

Set the production templates once, document the step, re-test a real invitation in production, and hand off to S-04/S-05 without editing their roadmap rows.

### Changes Required:

#### 1. Production setup docs

**File**: `README.md`

**Intent**: Record the one-time production step and its timing, next to the existing production setup sections.

**Contract**: a short "Production setup for email links (one-time)" subsection: in the Supabase dashboard (Authentication → Emails → Templates), replace the **Invite user** and **Reset password** bodies with `supabase/templates/invite.html` and `recovery.html`, after the PR's CI is green and before merging. It only needs repeating if those templates change.

#### 2. Infrastructure follow-up

**File**: `context/foundation/infrastructure.md`

**Intent**: Close the "no auth callback route" follow-up with what was actually built and why PKCE code exchange was not used.

**Contract**: update the follow-up note at line 117 and the risk-register rows at lines 98 and 100 (preview links: token_hash links use `{{ .SiteURL }}`, so they always point to production; invite re-test done).

#### 3. Roadmap handoff

**File**: `context/foundation/roadmap.md` (F-01 block only); GitHub issues #8 (S-04) and #5 (S-05)

**Intent**: Tell S-04 and S-05 what they inherit. This session edits only F-01's roadmap rows, so the handoff lives in F-01's block and as comments on the two slices' issues.

**Contract**: a "Handoff to S-04/S-05" line in F-01's roadmap block, plus the same text as a comment on #8 and #5: `/api/auth/confirm` forwards `invite` and `recovery` to `/dashboard` (constant in `src/lib/auth-link.ts`); each slice switches its type to its set-password page.

### Success Criteria:

#### Automated Verification:

- Prettier/lint clean on the changed docs: `npm run lint && npx prettier --check README.md context/foundation/infrastructure.md context/foundation/roadmap.md`

#### Manual Verification:

- Production Invite user and Reset password templates are set from the repo files (before merge)
- After deploy, a Supabase dashboard "Invite user" to a throwaway address delivers an email whose link goes to `https://mo-web.malpiszon.workers.dev/api/auth/confirm?…&type=invite`, and clicking it lands on `/dashboard` signed in; the test user is deleted afterwards

**Implementation Note**: The template step happens before merge; the invitation re-test happens after the deploy that follows the merge.

---

## Testing Strategy

### Unit Tests:

- `src/lib/auth-link.test.ts`: accepted types, rejected types, missing or empty fields.

### Integration Tests:

- Smoke (Phase 2): invite → session for a new user; recovery → session for the right existing user; reused/garbage token → sign-in error.

### Manual Testing Steps:

1. Local: generated invite link on the :4322 preview → `/dashboard`; reuse the link → sign-in error. After the user's Supabase restart: Studio invite → Mailpit link points to `/api/auth/confirm`.
2. Production: dashboard invite to a throwaway address → `/dashboard`; delete the user.

## Migration Notes

No database changes. The local stack must be restarted (`npx supabase stop && npx supabase start`) to pick up `config.toml` and template changes. It is shared with the parallel S-03 worktree, so only the user restarts it. Production templates are a manual, one-time dashboard edit done before merge.

## References

- Roadmap: `context/foundation/roadmap.md` § F-01; issue #2
- Infrastructure note on the missing callback: `context/foundation/infrastructure.md:117`
- Route pattern: `src/pages/api/auth/signin.ts`
- Sub-issues: Phase 1 #39, Phase 2 #42, Phase 3 #44

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Confirm route and local templates

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Type check and build pass: `npx astro check && npm run build`

#### Manual

- [x] 1.4 Generated invite link on the :4322 preview lands on /dashboard signed in
- [x] 1.5 Reopening the used invite link lands on /auth/signin with the friendly error
- [x] 1.6 After the user's Supabase restart, a Studio invite email in Mailpit links to /api/auth/confirm

### Phase 2: Smoke coverage in CI

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Smoke passes locally against the preview, email-link steps included
- [ ] 2.3 CI `ci` and `smoke` jobs are green on the PR

### Phase 3: Production configuration and verification

#### Automated

- [ ] 3.1 Prettier/lint clean on the changed docs

#### Manual

- [ ] 3.2 Production Invite user and Reset password templates are set from the repo files (before merge)
- [ ] 3.3 Production dashboard invite to a throwaway address lands on /dashboard signed in; test user deleted
