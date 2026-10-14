# Handled-Error Reporting — Plan Brief

> Full plan: `context/changes/report-handled-errors/plan.md`
> Research: `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` (observability audit, used in place of a research doc)

## What & Why

Sentry sees only thrown errors. When the database, PostgREST or Auth fails, mo-web catches the failure and shows a friendly page, returns an error code or falls back, then writes one console line. So an outage never reaches Sentry; the audit's probes P4 and P6 proved this. This change reports those handled **system** faults to Sentry, grouped so that an outage becomes one issue per step. User errors stay in the logs. It is roadmap S-08 (#143), and S-09 and S-10 reuse its helper.

## Starting Point

Sentry (S-07) reports unhandled errors from the Worker and the browser. The only capture call in `src/` is in the middleware. Services rebuild Supabase errors as message-only `Error`s without a `cause`. `docs/deployment.md` states that handled failures are not reported.

## Desired End State

The handled faults behind ten steps each produce a log line and one `handled: true` Sentry event. The steps cover MO delivery storage, plan and rating saves, dashboard and history loads, and set-password `updateUser`. Each event is grouped by `["handled", step, error code]` and keeps the original Supabase error as its cause, from which the helper reads the code and hint. Sentry links that cause only when it is an `Error` (an `AuthError`); a PostgREST database fault is a plain object, so its event shows the wrapper exception, whose message carries the original code and message. PostgREST `details` is never sent or logged. The dashboard and history pages answer 503 when plans can't be loaded, and the docs describe the new policy.

## Key Decisions Made

| Decision                  | Choice                                                                                                              | Why (1 sentence)                                                                      | Source         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------- |
| What counts as reportable | System faults only (the services' `failed` kind, `storage_failed`, load failures, non-user `updateUser` errors)     | Keeps the free plan's 5,000 events/month for real outages                             | Roadmap / user |
| Grouping                  | Fingerprint `["handled", step, code]`; code from the cause chain, else `http_<status>`, else `unknown`              | One issue per step and failure kind, even when a network error has an empty code      | Audit / Plan   |
| Annotation fallbacks      | Reported at level `warning` (dashboard recency and ratings, recency re-read after a save); main failures at `error` | The roadmap names fallbacks; a broken ratings grant would otherwise stay invisible    | Plan           |
| Fallback page status      | Dashboard and history answer 503 on a load failure (same card)                                                      | Status-based views see the outage too, not just Sentry                                | Plan           |
| Volume control            | No throttle; fingerprint + Dedupe + spike protection                                                                | 2–4 users make even a day-long outage a few hundred events                            | Plan           |
| Error fields              | Tags `step`, `error_code`, email-masked `error_hint`; `details` neither sent nor logged                             | `details` can echo row values (emails, the MO body); answers the issue's open unknown | Plan           |
| Verification              | Unit tests + one manual probe (preview → local listener, grants revoked)                                            | Deterministic CI tests plus one real end-to-end check, with nothing new for CI        | Plan           |

## Scope

**In scope:**

- `src/lib/report-handled-error.ts` and its tests.
- `{ cause }` on service and keep-alive errors (X5).
- Call sites:
  - D2: delivery `storage_failed`;
  - W6: plan-save write and recency;
  - rating save;
  - W3 and R2: dashboard and history loads, now answering 503;
  - A6: set-password `updateUser`.
- `docs/deployment.md` and `docs/api.md`.

**Out of scope:**

- Auth boundary classification (S-09), invitation and provisioning failures (S-10) and streamed render errors (S-11).
- Logging 404, 409, 400 and 401 outcomes, invariant checks, browser save reporting and island error boundaries (all parked).
- A degraded-view UI, throttling, a committed fake-ingest script or CI check, and alert rules.

## Architecture / Approach

Call sites pass a stable step name and the caught error to `reportHandledError(step, error, { level, code })`. The helper walks the `cause` chain for `code`, `status` and `hint`. It writes `<step> failed: <code> <message>` with the stack to `console.error` or `console.warn`, and calls `@sentry/cloudflare`'s `captureException` with a capture context (level, fingerprint, tags). The event reaches the client `withSentry` set up in `src/worker.ts`, and the existing `scrubEvent` masks emails in the messages, including any linked cause. The helper itself masks the hint tag, because tags bypass the scrubber.

## Phases at a Glance

| Phase                                | What it delivers                                                        | Key risk                                                           |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Reporting helper and error causes | Tested helper; Supabase errors kept as `cause`; no behaviour change yet | Wrong code extraction groups an outage under `unknown`             |
| 2. Report at the call sites          | Ten steps report; fallback pages answer 503; A6 classifier              | Reporting a user error by mistake, which costs event budget        |
| 3. Docs and runtime proof            | Policy rewritten in docs; probe proves grouping, level, privacy and 503 | The probe's revoked grants must be restored on the shared local DB |

**Prerequisites:** S-07 merged (done); local Supabase and a delivered test user for the probe.
**Estimated effort:** about 2 sessions across 3 phases.

## Open Risks & Assumptions

- Assumption: the pages' `captureException` reaches the client `withSentry` initialised. This is already true for the middleware, and the Phase 3 probe confirms it.
- PostgREST hints are generic text. They are masked and cut anyway, in case one echoes a value.
- Until S-10, a failed `createUser` shows up as `mo_delivery.ingest` `P0002` rather than as its real cause.

## Success Criteria (Summary)

- During a database outage, Sentry shows one issue per affected step whose message carries the original PostgREST code and message, and nothing for wrong passwords, locked weeks or bad links.
- The dashboard and history pages answer 503 when they can't load, so the outage shows in status-based views.
- No event or log line contains PostgREST `details`, a user or an email.
