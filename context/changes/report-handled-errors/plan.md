# Handled-Error Reporting Implementation Plan

## Overview

Make database, PostgREST and Auth faults that mo-web handles (with a friendly page, an error code or a fallback) reach Sentry: one issue per step and error code, with the original Supabase error kept as the event's cause. User errors (not found, locked, not rateable, week started, invalid input, weak password) stay in the Worker logs. This closes audit findings X3, X5, D2, W3, W6, R2 and A6, and it lays down the helper and policy that S-09 (auth faults) and S-10 (invitation failures) build on. Roadmap S-08, issue #143.

## Current State Analysis

- Only one `captureException` exists in `src/`: `src/middleware.ts:38`, for unhandled throws. Every handled failure ends in a message-only `console.error` and a friendly response. Probes P4 and P6 proved that Sentry receives nothing (audit §3).
- The policy is written down at `docs/deployment.md:96`: "**Not reported:** failures the app handles and answers with a success or a friendly message". `docs/api.md:67` documents the 200 "Couldn't load …" pages.
- Services rebuild Supabase errors as message-only `Error`s without a `cause`: `src/lib/services/plans.ts:38,67,94,123,147,193`, `src/lib/services/ratings.ts:47,55,78`, `src/lib/keepalive.ts:18`. `PlanWriteError` (`plans.ts:158`) and `RatingWriteError` (`ratings.ts:8`) take no cause.
- System faults are already kept apart from user errors: `planWriteErrorKind` and `ratingWriteErrorKind` map the deliberate errors to `not_found`, `plan_locked` and `not_rateable`, and everything else is `failed`. The delivery route handles `22P05` and `week_started` before its generic `storage_failed`.
- Handled-fault sites in scope:
  - `src/pages/api/mo/deliveries.ts:154-161`: `storage_failed`, two branches (D2).
  - `src/lib/plan-save.ts:43-57`: write `failed` (W6) and the recency re-read fallback.
  - `src/pages/api/ratings.ts:34-40`: `save_failed`.
  - `src/pages/dashboard.astro:39-64`: plan load (W3), plus the recency and ratings annotation fallbacks.
  - `src/pages/history/index.astro:20-23` and `src/pages/history/[id].astro:24-28` (R2).
  - `src/pages/api/auth/set-password.ts:78-80`: `updateUser` after the token was used (A6).
- The Worker's Sentry client comes from `withSentry` in `src/worker.ts:56`. Code running inside a request (middleware, pages, routes) reaches it through `@sentry/cloudflare`'s `captureException`, as `src/middleware.ts` already does.
- Scrubbing: `scrubEvent` (`src/lib/sentry-privacy.ts:61`) masks emails in the message and in every exception value, the `cause` chain included. It does **not** touch tags.

## Desired End State

- Each handled system fault listed above writes one Worker log line and sends one Sentry event with `handled: true`. The event:
  - is grouped by fingerprint `["handled", <step>, <error code>]`;
  - has level `error` for failures the user sees, and `warning` for annotation fallbacks where the page still works;
  - carries the tags `step` and `error_code`, plus `error_hint` when the error has one;
  - keeps the original Supabase error as `cause`, which the helper reads; Sentry links it only when it is an `Error` (e.g. an `AuthError`), so a PostgREST fault shows the wrapper exception alone, whose message carries the original code and message.
- PostgREST `details` never leaves the app, in either the Sentry event or the log line.
- The dashboard and both history pages answer **503** (same "Couldn't load …" card) when their plans can't be loaded.
- User errors produce no Sentry event.
- `docs/deployment.md` § Error monitoring and `docs/api.md` describe this.

Verify: unit tests for the helper, the error causes and the A6 classifier. Then one manual probe of a preview build that sends to a local listener, with grants revoked in local Postgres. It must show one grouped event per step, the right level and tags, no `details`, and a 503 page.

### Key Discoveries:

- `PostgrestError` extends `Error` and carries `code`, `hint` and `details` (`node_modules/@supabase/postgrest-js/dist/index.d.mts:26`), and Supabase's `AuthError` extends `Error` with `code` and `status`. Both can be passed as `cause` directly. But with the default (non-`throwOnError`) client, postgrest-js returns a PostgREST HTTP error response (every DB fault) as a plain object (`error = JSON.parse(body)`, `dist/index.mjs:513`); only transport failures are `PostgrestError` instances (with `code: ""` and no `status`). Sentry's linked-errors integration follows a cause only when `isError(cause)` (`@sentry/core` `aggregate-errors.js:26`), and then sends its type and message only; a plain-object cause is not linked (implementation review F1, 2026-10-13). `details` would only travel through the ExtraErrorData integration, which is off and must stay off.
- A PostgREST network failure comes back with an empty `code`. The helper has to fall back to `http_<status>` or `unknown`, or the fingerprint would read `["handled", step, ""]`.
- A6's user errors are exactly the keys of `MESSAGES_BY_CODE` (`src/lib/set-password.ts:98`: `weak_password`, `same_password`, `over_email_send_rate_limit`) plus status 429. `passwordErrorMessage` maps them, and anything else gets the generic message.
- `docs/api.md:67,115` quote today's log prefixes (`dashboard ratings load failed: …`); they change with the step names.

## What We're NOT Doing

- Auth fault classification beyond A6: the middleware `getUser()` error, `verifyOtp`, forgot-password, sign-in and sign-out (S-09).
- Invitation and account-provisioning failures in the delivery route: the `inviteUserByEmail`, `createUser` and `updateUserById` logs, `invitation_sent`, and secret checks (S-10, findings D1, D3, D4, D6, D10). Until S-10, a doomed second `ingest_weekly_plan` call after a failed `createUser` reports as `mo_delivery.ingest` `P0002`.
- Streamed render errors (S-11).
- Logging the 404/409/400/401 outcomes, invariant checks (W2, R1, R3, R5) and browser save reporting (W5, R6, X8). These are parked in the roadmap.
- Marking the dashboard as degraded in the UI when recency or ratings fail (the UI part of W8). Only the warning event is added.
- Throttling or sampling events. The fingerprint, Sentry's Dedupe and spike protection are enough for 2–4 users.
- Sending or logging PostgREST `details`.
- A committed fake-ingest script or a CI check that events arrive.
- Sentry alert rules (FR-019 stays parked).

## Implementation Approach

A single helper in `src/lib/` owns the policy: what goes to the log line and what goes to Sentry, how a fault is grouped, and which fields are allowed. Each call site gives it a stable step name and the error, and passes level `warning` where the page still works. Services keep their message format but attach the original Supabase error as `cause`. That way the helper can read `code` and `hint` from the cause chain, and Sentry links the original error.

Step names (stable, also the log-line prefix):

| Step                            | Site                                               | Level   |
| ------------------------------- | -------------------------------------------------- | ------- |
| `mo_delivery.ingest`            | `deliveries.ts` `storage_failed` (both branches)   | error   |
| `plan_save.write`               | `plan-save.ts` write `failed`                      | error   |
| `plan_save.recency`             | `plan-save.ts` recency re-read                     | warning |
| `rating_save.write`             | `api/ratings.ts` `failed`                          | error   |
| `dashboard.plan_load`           | `dashboard.astro` plan load                        | error   |
| `dashboard.recency_load`        | `dashboard.astro` recency                          | warning |
| `dashboard.ratings_load`        | `dashboard.astro` ratings                          | warning |
| `history.list_load`             | `history/index.astro`                              | error   |
| `history.plan_load`             | `history/[id].astro`                               | error   |
| `auth.set_password.update_user` | `set-password.ts` `updateUser`, system faults only | error   |

## Critical Implementation Details

- **Capture context, not a mechanism.** `captureException`'s second argument is either an event hint (`mechanism`) or a capture context (`level`, `tags`, `fingerprint`), not both. Pass the capture context. `captureException` already marks the event `handled: true`, so no mechanism is needed. The middleware's `mechanism: { handled: false }` stays as it is.
- **Tags bypass the scrubber.** `scrubEvent` doesn't touch `event.tags`, so the helper must run `error_hint` through the same email masking (export `maskEmails` from `sentry-privacy.ts`) and cut it to Sentry's 200-character tag limit. `step` and `error_code` come from code, not from user data.

## Phase 1: Reporting helper and error causes

### Overview

Add the helper and its tests, and give every rebuilt Supabase error its original as `cause`. Nothing calls the helper yet, so behaviour doesn't change.

### Changes Required:

#### 1. Reporting helper

**File**: `src/lib/report-handled-error.ts` (new), `src/lib/report-handled-error.test.ts` (new)

**Intent**: One place that turns a handled system fault into a log line and a grouped Sentry event, so every call site follows the same policy and S-09 and S-10 can reuse it.

**Contract**: `reportHandledError(step: string, error: unknown, options?: { level?: "error" | "warning"; code?: string }): void`.

- **Error code:** `options.code` if given. Otherwise the first non-empty string `code` found walking `error` → `error.cause` → …, then `http_<status>` from the first numeric `status`, then `"unknown"`.
- **Hint:** the first non-empty string `hint` in the same chain, emails masked, cut to 200 characters.
- **Log line:** `console.error` (level `error`, the default) or `console.warn` (`warning`). The line reads `` `${step} failed: ${code} ${message}` ``, where `message` is the error's message, and the error's stack follows as a second argument.
- **Sentry:** `captureException(error, { level, fingerprint: ["handled", step, code], tags: { step, error_code: code, error_hint? } })` from `@sentry/cloudflare`.
- **Never read:** `details`, request bodies and users.

The tests mock `@sentry/cloudflare` and the console. They cover:

- the code taken from a direct error, from a nested cause, from `status`, from `options.code`, and the `unknown` fallback;
- the empty-string code of a network failure;
- level `warning` using `console.warn`;
- the fingerprint and tags;
- a hint containing an email being masked;
- an over-long hint being cut;
- a `details` field never appearing in the capture arguments or the log line.

#### 2. Email masking export

**File**: `src/lib/sentry-privacy.ts`

**Intent**: Let the helper mask the hint tag with the same rule the scrubber uses.

**Contract**: export the existing `maskEmails(text: string): string`; no behaviour change.

#### 3. Keep the original error as cause (X5)

**File**: `src/lib/services/plans.ts`, `src/lib/services/ratings.ts`, `src/lib/keepalive.ts`, and their tests (`src/lib/services/plans.test.ts`, `src/lib/services/ratings.test.ts`)

**Intent**: Sentry links the original PostgREST error, and the helper reads its `code` and `hint`. Messages stay the same, so existing logs and tests still match.

**Contract**:

- Each `throw new Error(\`… ${code} ${message}\`)`built from a Supabase error passes`{ cause: <the Supabase error> }`.
- `PlanWriteError` and `RatingWriteError` constructors take an optional third `options?: ErrorOptions` and pass it to `super`.
- `savePlan` and `rateMeal` pass the RPC error as cause. Their "returned no saved_at/rating" throws have no cause.
- Service tests assert `cause` is the Supabase error object for one read and one write per service.

### Success Criteria:

#### Automated Verification:

- Helper unit tests pass: `npx vitest run src/lib/report-handled-error.test.ts`
- Service tests assert the cause and pass: `npx vitest run src/lib/services`
- All unit tests pass: `npm test`
- Lint and type-checked rules pass: `npm run lint`

**Implementation Note**: Phase 1 has no manual step; continue to Phase 2 once the automated checks pass.

---

## Phase 2: Report at the call sites

### Overview

Route every in-scope handled system fault through the helper, using the step names and levels from the Implementation Approach table, and make the fallback pages answer 503.

### Changes Required:

#### 1. MO delivery storage failure (D2)

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: An `ingest_weekly_plan` failure that MO receives as 500 `storage_failed` becomes a Sentry issue, not just a console line.

**Contract**:

- The `result.error` branch calls `reportHandledError("mo_delivery.ingest", new Error(\`ingest_weekly_plan failed: …\`, { cause: result.error }))`.
- The "returned no plan id" branch calls it with `{ code: "no_plan_id" }`.
- `logStorageError` stays only for the invitation and provisioning steps (S-10 scope).
- The response body and status are unchanged.

#### 2. Plan saves and ratings (W6)

**File**: `src/lib/plan-save.ts`, `src/pages/api/ratings.ts`

**Intent**: Saves that fail for system reasons are reported. The recency re-read failure, where the save still stands, is reported at warning level. The `not_found`, `plan_locked` and `not_rateable` kinds stay silent, as today.

**Contract**:

- In `plan-save.ts`, `logError` is replaced by `reportHandledError("plan_save.write", error)` for kind `failed` and `reportHandledError("plan_save.recency", error, { level: "warning" })`.
- In `api/ratings.ts`, `reportHandledError("rating_save.write", error)` for kind `failed`.
- Responses are unchanged.

#### 3. Dashboard and history pages (W3, R2)

**File**: `src/pages/dashboard.astro`, `src/pages/history/index.astro`, `src/pages/history/[id].astro`

**Intent**: A plan-load failure is reported, and the page answers 503 so status-based views see the outage as well. Failures loading recency or ratings on the dashboard are reported as warnings, and the page renders as today.

**Contract**:

- Each `console.error` in a `catch` or rejection handler becomes `reportHandledError(<step>, error[, { level: "warning" }])` with the steps from the table.
- On the `loadFailed` branch, set `Astro.response.status = 503`, before any rendering, in the frontmatter. In `history/[id].astro` the existing `404` assignment keeps its `!loadFailed` guard.
- The page markup is unchanged.

#### 4. Set-password after the token is used (A6)

**File**: `src/lib/set-password.ts`, `src/lib/set-password.test.ts`, `src/pages/api/auth/set-password.ts`

**Intent**: An `updateUser` failure that isn't the user's fault (anything except a weak or repeated password or a rate limit) is reported, because a systemic break leaves every invited user unable to finish setup. User errors keep today's log line.

**Contract**:

- New `isPasswordUserError(error: AuthErrorLike | null | undefined): boolean` in `src/lib/set-password.ts`. It returns true when `error.code` is a key of `MESSAGES_BY_CODE` or `error.status === 429`.
- The route calls `reportHandledError("auth.set_password.update_user", error)` when it returns false, and keeps the existing `console.error` line otherwise.
- Tests cover each user code, 429, and a 500 or unknown code.
- The redirect and the retry cookie are unchanged.

### Success Criteria:

#### Automated Verification:

- A6 classifier tests pass: `npx vitest run src/lib/set-password.test.ts`
- No in-scope site still logs a handled system fault with a bare `console.error`: `grep -n "console.error" src/lib/plan-save.ts src/pages/api/ratings.ts src/pages/dashboard.astro src/pages/history/index.astro "src/pages/history/[id].astro"` prints nothing
- All unit tests pass: `npm test`
- Lint and type-checked rules pass: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke test passes against a preview on port 4322: `npm run smoke`

**Implementation Note**: Phase 2's behaviour is proven end to end by Phase 3's manual probe. Continue once the automated checks pass.

---

## Phase 3: Docs and runtime proof

### Overview

Rewrite the reporting policy in the docs, and prove on a real Worker build that handled faults reach Sentry grouped, at the right level, without `details`, and that the fallback pages answer 503.

### Changes Required:

#### 1. Error-monitoring policy

**File**: `docs/deployment.md` (§ Error monitoring (Sentry))

**Intent**: The doc describes what is reported now, replacing "handled failures are not reported" (CLAUDE.md docs rule).

**Contract**:

- **Reported** gains "system faults the app handles": database, PostgREST and Auth errors behind a friendly page, an error code or a fallback. Each is one Sentry issue per step and error code, at level error, or warning when the page still works.
- **Not reported** becomes user errors (not found, locked, not rateable, week started, invalid input, weak password, rate limits). It also notes that invitation, sign-in, link-check and streamed-render failures are only logged until S-09, S-10 and S-11.
- **Privacy** gains the tags `step`, `error_code` and `error_hint` (email-masked), and states that PostgREST `details` is never sent or logged.
- Add a one-line note on volume: no throttling; a whole outage groups into one issue per step, and the free plan's spike protection applies.

#### 2. Pages and routes

**File**: `docs/api.md`

**Intent**: Document the 503 fallback pages and the new log prefixes.

**Contract**:

- Line 67: the dashboard and both history pages answer **503** with "Couldn't load …", and the fault is reported to Sentry.
- Line 115: the ratings fallback logs `dashboard.ratings_load failed: …` and reports a warning.
- Any other quoted log prefix that Phase 2 changed is updated (`grep -rn "load failed\|save failed\|plan save" docs/`).

### Success Criteria:

#### Automated Verification:

- No doc quotes an old log prefix: `grep -rn "dashboard plan load failed\|dashboard recency load failed\|dashboard ratings load failed\|history load failed\|plan save write failed\|rating save failed" docs/` prints nothing
- Formatting passes: `npx prettier --check docs/deployment.md docs/api.md`

#### Manual Verification:

- Probe setup:
  1. Build with `PUBLIC_SENTRY_DSN=http://public@127.0.0.1:9876/1`, and put the same value in `.dev.vars`.
  2. Run `npm run preview` on port 4322.
  3. Run a throwaway listener on port 9876 that prints each envelope.
  4. Deliver a week for a test user and sign in ([dev walkthrough](../../../docs/dev-walkthrough.md)).
- Dashboard: with `select` on `public.weekly_plans` revoked from `authenticated` in local Postgres, `/dashboard` answers 503 "Couldn't load your plan". Three reloads give three events with the same fingerprint `["handled","dashboard.plan_load","42501"]`, level `error`, tags `step` and `error_code` (`42501`), one exception whose message carries the original code and message (no linked cause: PostgREST errors are plain objects), and no `details` anywhere in the envelope. `/history` gives `history.list_load` the same way.
  - Review note (2026-10-14): Sentry's Dedupe integration drops an event identical to the previous one from the same Worker instance, so the run gave 2 events for 3 reloads (1 for 4). The probe holds as "at least one event with that fingerprint"; `docs/deployment.md` § Volume records this.
- Ratings annotation: with `execute` on `get_plan_ratings` revoked, the dashboard renders (200) and sends one `dashboard.ratings_load` event at level `warning`.
- Saves and delivery: with `execute` on `choose_plan_option` revoked, a swap answers 500 `save_failed` and sends `plan_save.write`. With `execute` on `ingest_weekly_plan` revoked from `service_role`, an MO delivery answers 500 `storage_failed` and sends `mo_delivery.ingest`.
- No events for user errors: a 409 `plan_locked` or `not_rateable`, a 404 `/history/<unknown uuid>`, and a 400 delivery send nothing to the listener.
- Cleanup: all grants are restored from their migrations (or `npx supabase db reset` plus a re-delivery), the listener is stopped, and the DSN is removed from `.dev.vars`.

**Implementation Note**: After the automated checks pass, pause for the human to confirm the manual probe before opening the PR.

---

## Testing Strategy

### Unit Tests:

- `report-handled-error.test.ts`:
  - picks the code from the direct error, a nested cause, `status` or `options.code`, and falls back to `unknown` when the code is empty;
  - level `warning` uses `console.warn` and sends a warning event;
  - the fingerprint and tags are exact;
  - the hint is email-masked and cut to 200 characters;
  - `details` is absent from all outputs.
- Service tests: `cause` is the Supabase error object for a failed read and a failed write in `plans` and `ratings`, and messages are unchanged.
- `set-password.test.ts`: `isPasswordUserError` is true for `weak_password`, `same_password`, `over_email_send_rate_limit` and status 429; false for status 500, an unknown code and `null`.

### Integration Tests:

- The existing smoke and e2e runs stay green. No new automated end-to-end check, as decided in planning.

### Manual Testing Steps:

1. The Phase 3 probe: revoke a grant, load the page or call the route, read the envelope in the listener, restore the grant.
2. Check one `warning` and one `error` envelope by eye for `user`, `request.data`, `details` and emails.

## Performance Considerations

One extra `captureException` per failing request, only on error paths. No change on the success path.

## Migration Notes

No database migration and no new secret. Behaviour changes only on failure paths, plus the 503 status. Safe to deploy in any order relative to the database.

## References

- Audit: `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §4 RC1 and RC6, §5 (X3, X5, D2, W3, W6, R2, A6), §6 step 2
- Roadmap: `context/foundation/roadmap.md` § S-08; issue #143
- Sentry setup this builds on: `context/changes/add-sentry/plan.md`, `src/lib/sentry.ts`, `src/lib/sentry-privacy.ts`, `src/middleware.ts:35-38`
- Phase sub-issues: Phase 1 #150, Phase 2 #151, Phase 3 #152

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reporting helper and error causes

#### Automated

- [x] 1.1 Helper unit tests pass: `npx vitest run src/lib/report-handled-error.test.ts` — b2afa59
- [x] 1.2 Service tests assert the cause and pass: `npx vitest run src/lib/services` — b2afa59
- [x] 1.3 All unit tests pass: `npm test` — b2afa59
- [x] 1.4 Lint and type-checked rules pass: `npm run lint` — b2afa59

### Phase 2: Report at the call sites

#### Automated

- [x] 2.1 A6 classifier tests pass: `npx vitest run src/lib/set-password.test.ts` — 1f2ed8a
- [x] 2.2 No in-scope site still logs a handled system fault with a bare `console.error` — 1f2ed8a
- [x] 2.3 All unit tests pass: `npm test` — 1f2ed8a
- [x] 2.4 Lint and type-checked rules pass: `npm run lint` — 1f2ed8a
- [x] 2.5 Production build succeeds: `npm run build` — 1f2ed8a
- [x] 2.6 Smoke test passes against a preview on port 4322: `npm run smoke` — 1f2ed8a

### Phase 3: Docs and runtime proof

#### Automated

- [x] 3.1 No doc quotes an old log prefix — 6cc5145
- [x] 3.2 Formatting passes: `npx prettier --check docs/deployment.md docs/api.md` — 6cc5145

#### Manual

- [x] 3.3 Probe setup: preview build sending to a local listener, test user signed in — 6cc5145
- [x] 3.4 Dashboard and history plan-load faults: 503, one grouped error event per step, no `details` — 6cc5145
- [x] 3.5 Ratings annotation fault: page renders, one warning event — 6cc5145
- [x] 3.6 Save and delivery faults reported as `plan_save.write` and `mo_delivery.ingest` — 6cc5145
- [x] 3.7 No events for user errors — 6cc5145
- [x] 3.8 Cleanup: grants restored, listener stopped, DSN removed from `.dev.vars` — 6cc5145
