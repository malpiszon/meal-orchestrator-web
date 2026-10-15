# Auth Fault Visibility — Plan Brief

> Full plan: `context/changes/auth-fault-visibility/plan.md`
> Research: `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` (observability audit, used in place of a research doc)

## What & Why

When Supabase Auth fails, mo-web makes it look like something normal. An outage looks like everyone signing out, every invitation link expiring or a wrong password, and a missing Supabase secret silently breaks sign-in. None of this reaches Sentry. This change reports those system faults and tells the user to try again where that applies. It is roadmap S-09 (#144) and covers two of the audit's three critical findings (X1, A1), plus X4, A2–A4 and A8.

## Starting Point

S-08 added `reportHandledError`, which writes one log line and sends one Sentry event grouped by step and code. It already covers set-password's `updateUser`. Elsewhere:

- the middleware ignores `getUser()`'s error;
- set-password maps every `verifyOtp` error to "link expired";
- sign-in logs wrong passwords at `console.error`;
- forgot-password and the link check only log;
- the Supabase client factories return `null` with no log when a secret is missing.

## Desired End State

Each of these is reported as one grouped Sentry event:

- an Auth outage during the session check, link verification, sign-in or a reset email;
- a failing link check (level `warning`);
- a missing secret, once per secret per Worker isolate.

What the user sees:

- **Protected pages:** during an outage they go to sign-in with "We couldn't check your sign-in. Try again in a moment."
- **Link verification:** a fault keeps the user on the form, with the link and "try again".
- **Unchanged:** wrong passwords, dead links and the reset page's success copy look as before.

What stays out of Sentry: anonymous visits, expired sessions, dead links, wrong passwords and rate limits.

## Key Decisions Made

| Decision                | Choice                                                                                                                 | Why (1 sentence)                                                                             | Source            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------- |
| Scope                   | MS-09 (X1, X4, A1–A4) plus the link-check failure (A8); not sign-out (A7) or A5, A9, A10                               | The roadmap outcome and `docs/deployment.md` already promise link-check failures for S-09    | Plan (user)       |
| What counts as a fault  | Status 0 or ≥ 500, a non-JSON response, no code, or a code outside the site's quiet list; 429 never                    | A GoTrue 5xx reaches the client with no code, so status and absence of a code are the signal | Research (probes) |
| Dead-link code          | Only `otp_expired` means "invalid or has expired"                                                                      | GoTrue answers it for expired, used and made-up tokens alike; everything else is a fault     | Research (probes) |
| Session outage UX       | Report; protected pages go to `/auth/signin?error=session_unavailable` with a "try again" notice; JSON routes keep 401 | Small change; the cookies survive a retryable failure, so a reload after recovery just works | Plan (user)       |
| Link-verification fault | Back to the form with the same link and "Couldn't check your link. Try again in a moment."                             | The token was most likely not used, so one more tap usually works                            | Plan (user)       |
| Rate limits             | `console.warn` with a stable `auth <site>: rate limited` prefix, no Sentry event                                       | Matches S-08's policy (rate limits are user errors) and spends no event budget               | Plan (user)       |
| Missing secrets         | One event per missing secret per isolate, step `supabase.config`, code `missing_<NAME>`, names only                    | One issue per secret, not one event per page view                                            | Plan (user)       |
| Reset email             | Keep `?sent=1` and report the fault                                                                                    | Unknown emails answer 200, so reporting reveals nothing and the copy stays non-enumerating   | Audit / Plan      |

## Scope

**In scope:**

- `src/lib/auth-errors.ts` (the classifier), `src/lib/auth-session.ts` (the session read) and `src/lib/missing-secrets.ts`, each with tests.
- Changes to `src/middleware.ts`, `src/lib/supabase.ts`, the set-password, sign-in and forgot-password routes, and `src/lib/services/auth-links.ts`.
- The sign-in notice and the set-password "try again" copy.
- `docs/deployment.md` and `docs/api.md`.

**Out of scope:**

- Sign-out errors (A7), the link check's "not live" reason (A5) and the malformed-form and malformed-link warns (A9, A10).
- Delivery and invitation faults (S-10) and streamed render errors (S-11).
- 503 answers instead of 401 on the JSON routes.
- Sentry events for rate limits, alert rules, and failing boot on a missing secret.
- Shortening the client's up-to-30 s refresh retry.

## Architecture / Approach

Each call site passes its Auth error and its own quiet code list to `isAuthSystemFault`:

- **Fault:** the error goes unchanged to `reportHandledError(step, error)`, so the event keeps the `AuthError`'s status and message. An outage groups as `http_0` or `http_<status>`.
- **Rate limit:** a warn line.
- **Quiet code:** at most an info line.

The middleware's `getUser()` read moves into `readSessionUser`, which returns `{ user, fault }`. The middleware uses the `fault` flag to pick the sign-in redirect with the notice. The Supabase client factories call `reportMissingSecrets(names)`, which keeps a module-level set so each name is reported once per isolate.

## Phases at a Glance

| Phase                                    | What it delivers                                                                                    | Key risk                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Classifier, session check and secrets | Tested fault rule; the middleware reports and shows `session_unavailable`; missing secrets reported | Misclassifying a normal sign-out code as a fault spends event budget on every page view |
| 2. Auth routes                           | set-password (link kept, "try again"), sign-in, forgot-password and the link check report faults    | Breaking the dead-link and wrong-password paths the smoke test guards                   |
| 3. Docs and runtime proof                | Docs updated; the probe proves reporting, grouping, copy, recovery and privacy                      | Forgetting to restore `.dev.vars` after pointing it at the proxy                        |

**Prerequisites:** S-08 merged (done); local Supabase with Mailpit, and a delivered test user for the probe.
**Estimated effort:** about 2 sessions across 3 phases.

## Open Risks & Assumptions

- **Hosted Supabase Auth may differ from local v2.197.0.** It might return a sign-out code that isn't on the quiet lists. That would show up as a Sentry issue with a 4xx code; the fix is to add the code to the list.
- **An Auth outage can still stall the session check for up to about 30 s** while the client retries a refresh. This is recorded in Known risks, not fixed.
- **Status 0 includes aborted requests** (a client disconnect), so `auth.session` `http_0` can carry a little noise.

## Success Criteria (Summary)

- During an Auth outage, Sentry shows one issue per affected step, and users are told to try again instead of seeing a sign-out or an expired invitation.
- Anonymous visits, dead links, wrong passwords and rate limits send nothing, and the smoke test's user-visible outcomes are unchanged.
- No event contains an email, a token, a password or a cookie.
