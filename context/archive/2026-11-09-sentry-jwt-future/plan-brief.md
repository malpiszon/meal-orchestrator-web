# Retry PGRST303 "JWT issued at future" on MO delivery — Plan Brief

> Full plan: `context/changes/sentry-jwt-future/plan.md`
> Research: `context/changes/sentry-jwt-future/research.md`

## What & Why

Hosted PostgREST v14.5 sometimes rejects a freshly minted token with `401 PGRST303 JWT issued at future` (a stale-clock bug, fixed upstream in v14.18). On the MO delivery path, that 401 is classified as a rejected service-role key. MO gets 503 `not_configured` and Sentry gets an error-level `mo_delivery.config` event (MO-WEB-8). Both affected deliveries got through on MO's own retry, so the problem is a misleading Sentry error, not lost weeks.

## Starting Point

The page and rating services already retry this exact error through `withPgrst303Retry` (500 ms, then 1500 ms). The delivery handler's `ingest_weekly_plan` closure (`src/lib/services/mo-deliveries.ts:109`) isn't wrapped, and `isAuthRejection` counts any 401 as a key fault.

## Desired End State

A transient "issued at future" on a delivery is retried inside the request and usually succeeds without any Sentry event. If it still fails after the retries, MO gets a retryable 500 `storage_failed` and Sentry gets a quiet `mo_delivery.ingest` warning. Real key rejections still answer 503 with an error-level `mo_delivery.config` event.

## Key Decisions Made

| Decision                     | Choice                                                              | Why (1 sentence)                                                                    | Source   |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| Retry mechanism              | Wrap the `ingest` closure in `withPgrst303Retry`                    | Proven helper; one wrap covers the first call and the post-provisioning call        | Research |
| Retry timing                 | Reuse 500/1500 ms (≈2 s)                                            | Same as other services; MO's own backoff covers a longer stale window               | Plan     |
| Exhausted "issued at future" | 500 `storage_failed` + `mo_delivery.ingest` at `warning`            | Not a key fault, and MO's retry usually delivers, so it should be visible but quiet | Plan     |
| Real key rejections          | Unchanged: 503 `not_configured` + `mo_delivery.config` error        | Those can't succeed on retry and need a deploy fix                                  | Research |
| Classifier                   | New handler branch ahead of `isAuthRejection`; classifier unchanged | Keeps the classifier's contract for its other callers                               | Plan     |
| Scope                        | Delivery only; `auth_link_is_valid` not wrapped                     | No observed failure there; it fails open behind a 2 s timeout                       | Plan     |
| Did weeks arrive?            | Yes, both via MO's retry                                            | Answers #203's first open unknown                                                   | Plan     |

## Scope

**In scope:**

- Retry and reclassification in `handleMoDelivery`
- Unit tests: retry succeeds, retries run out, other PGRST303 still a key fault
- `docs/mo-delivery-contract.md`, `docs/api.md`, `docs/deployment.md`
- #203 unknowns and DoD, and a PR with `Closes #203` and `Fixes MO-WEB-8`

**Out of scope:**

- Changing the retry helper or its delays
- Wrapping `auth_link_is_valid` or GoTrue admin calls
- A new Sentry step, response code or contract row; any change to MO

## Architecture / Approach

`ingest` becomes `() => withPgrst303Retry("ingest_weekly_plan", () => supabase.rpc(...))`. After the calls, a new branch checks `isJwtIssuedAtFuture(result.error)` before the auth-rejection check and routes that case to the storage response at warning level. Everything else falls through to the existing branches.

## Phases at a Glance

| Phase                                           | What it delivers                                                        | Key risk                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Retry and reclassify in the delivery handler | Retry plus the new branch, with three new unit tests                    | Branch placed after `isAuthRejection` would keep the 503                 |
| 2. Docs and rollout check                       | Docs updated, #203 settled, PR resolves MO-WEB-8, next delivery checked | PGRST303 can't be reproduced on demand, so only the next run confirms it |

**Prerequisites:** None (no migration, no secret, no dashboard setting).
**Estimated effort:** ~1 session across 2 small phases, plus watching the next weekly MO run.

## Open Risks & Assumptions

- The stale-clock window may sometimes outlast ~2 s (supabase/supabase#50651). Then the exhausted-retry warning fires and MO's backoff delivers the week.
- Production PostgREST version wasn't re-checked after 2026-10-04. On ≥ v14.18 the retry never triggers, which is harmless.
- That the gateway mints a JWT per request from the `sb_secret_…` key is inferred from the error, not documented.

## Success Criteria (Summary)

- The next weekly MO delivery raises no MO-WEB-8 (`mo_delivery.config`) event.
- A real key misconfiguration still answers 503 and raises an error-level `mo_delivery.config` event.
- Unit tests prove the retry-succeeds and retries-exhausted paths.
