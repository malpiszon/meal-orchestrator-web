---
date: 2026-11-09T16:22:49+01:00
researcher: Claude (Opus 5.5)
git_commit: 78c2ad7d4c84421b954b189e9aa31dc78880fe69
branch: sentry-jwt-future
repository: malpiszon/meal-orchestrator-web
topic: 'Why MO deliveries fail with 401 PGRST303 "JWT issued at future" (Sentry MO-WEB-8, #203), and what the code does with it'
tags: [research, mo-delivery, postgrest, pgrst303, sentry, service-role-key]
status: complete
last_updated: 2026-11-09
last_updated_by: Claude (Opus 5.5)
---

# Research: PGRST303 "JWT issued at future" on MO delivery

**Date**: 2026-11-09T16:22:49+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 78c2ad7 (the same SHA as the release of the 2026-11-03 Sentry event)
**Branch**: sentry-jwt-future
**Repository**: malpiszon/meal-orchestrator-web

## Research Question

A JWT problem shows up on MO deliveries (Sentry [MO-WEB-8](https://malpiszon.sentry.io/issues/MO-WEB-8), issue #203): `ingest_weekly_plan rejected the key: 401 PGRST303 JWT issued at future`. What is the cause, why does the delivery path not handle it the way the rest of the app does, what does MO receive, and what did earlier changes decide that bears on a fix?

## Summary

- **The cause is a known PostgREST bug, not a bad key.** Hosted PostgREST v14.5 checks a token's `iat` against a stale cached "now". Upstream fixed this in v14.18 (#5196). The archived change `2026-10-04-dashboard-pgrst303-retry` diagnosed it and added `withPgrst303Retry`, which retries only PGRST303 "issued at future" after 500 ms and 1500 ms (`src/lib/postgrest-retry.ts:1-7,18-20`). Production was last confirmed on v14.5 on 2026-10-04 (`context/archive/2026-10-04-dashboard-pgrst303-retry/frame.md:30`). The October/November events suggest it is still affected (inference; not re-checked).
- **The delivery path was left out on purpose, and that assumption has been disproved.** That change scoped out "the MO delivery (`ingest_weekly_plan`, service-role key, not a fresh user JWT)" (`context/archive/2026-10-04-dashboard-pgrst303-retry/plan.md:33`). Production uses an `sb_secret_…` key (`context/archive/2026-09-30-mo-weekly-delivery/reviews/impl-review.md:85`). MO-WEB-8 shows that PostgREST receives a JWT with a fresh `iat` for that key too. The mechanism (the hosted gateway minting a short-lived JWT from the secret key) is an inference; no repo document or inspected source confirms it.
- **On this path the error becomes a configuration fault.** Neither `ingest_weekly_plan` call is wrapped in `withPgrst303Retry` (`src/lib/services/mo-deliveries.ts:109,111,149`). After either call, `isAuthRejection` treats any 401/403 as a rejected key (`src/lib/mo-delivery-faults.ts:26-29`). So PGRST303 answers MO with 503 `{"error":"not_configured"}` and reports a `mo_delivery.config` error (`src/lib/services/mo-deliveries.ts:46-49,153-165`). The contract tells MO this is "a deploy problem", and MO should retry it with backoff and then alert (`docs/mo-delivery-contract.md:124`).
- **Observed frequency:** Sentry has 2 events in 90 days, on 2026-10-28T17:34Z (release 0652b76) and 2026-11-03T16:45Z (release 78c2ad7). Each was resolved manually within 2–5 minutes, and neither has a comment. Whether the affected weeks arrived (through MO's automatic retry or a manual re-POST) is not recorded in Sentry or in this repo.

## Detailed Findings

### Delivery handler (`src/lib/services/mo-deliveries.ts`)

- `ingest` is a closure that builds a new RPC each time it is called (`:109`). That is the shape `withPgrst303Retry` needs: a new builder per call (`src/lib/postgrest-retry.ts:23-29`). The handler calls it once (`:111`). On `P0002 unknown_user` it provisions the account and calls it a second time (`:115-149`).
- Both calls fall through to one check: `result.error && isAuthRejection({ code, status })` → `configurationFault(...)` (`:153-165`). `configurationFault` calls `reportHandledError("mo_delivery.config", error)` and returns 503 `not_configured` (`:46-49`).
- Errors that are not auth rejections go to `mo_delivery.ingest` → 500 `storage_failed` (`:183-188`), except `22P05` → 400 and `55000 week_started` → 409 (`:167-182`).
- A retry of `ingest_weekly_plan` can't store a week twice. PGRST303 is raised before any SQL runs (`context/archive/2026-10-04-dashboard-pgrst303-retry/plan.md:25`, also `src/lib/services/ratings.ts:35`). Even if a request did reach SQL, a re-send of an identical body is a no-op (`docs/mo-delivery-contract.md:133-137`).

### Fault classification (`src/lib/mo-delivery-faults.ts`)

- `isAuthRejection` returns true for status 401 or 403, or for code `PGRST301`/`PGRST302` (`:12,26-29`). PGRST303 isn't in that code set. It counts as a key rejection only because PostgREST answers it with HTTP 401. The review of `2026-10-15-mo-invitation-failure-visible` already noted that PGRST303 "is likewise caught only through the status" (`context/archive/2026-10-15-mo-invitation-failure-visible/reviews/impl-review-phase-1.md:33`).
- `isJwtIssuedAtFuture` (`src/lib/postgrest-retry.ts:18-20`) already separates the transient variant from other PGRST303 claim failures (an expired or invalid claim), which a retry can't fix.

### The existing retry and where it applies

- `withPgrst303Retry(label, run)` makes 3 attempts in total (the first plus 2 retries, `PGRST303_RETRY_DELAYS_MS = [500, 1500]`). Each retry writes a `console.warn` line. After the last retry it returns the last result unchanged, so the caller's own error handling still applies (`src/lib/postgrest-retry.ts:7,30-45`).
- Call sites (grep over `src/`): the 4 `weekly_plans` queries, `get_plan_recency` and the generic RPC wrapper in `src/lib/services/plans.ts` (`:25,53,83,111,142,192`), and `rate_meal` in `src/lib/services/ratings.ts:42`. `src/lib/services/mo-deliveries.ts` has none.
- `docs/api.md:70` describes the retry only for page loads right after sign-in.

### What MO sees

- Contract row 503 `not_configured`: "mo-web's secrets are missing, or mo-web's database or auth rejects its service-role key (a deploy problem)". Action: "Retry with backoff (below), then alert" (`docs/mo-delivery-contract.md:124`). Row 500 `storage_failed` has the same action (`:123`). So for MO's retry behaviour the difference between 503 and 500 is only in the meaning of the code, not in what MO does.
- MO's retry uses `with_retries` + `is_transient_http_error` and posts to Discord on a final failure (`docs/mo-delivery-contract.md:125,160-161`). This repo doesn't show which statuses `is_transient_http_error` covers or how long the backoff is (that is MO's code).

### Sentry evidence

- MO-WEB-8, level error, tags `step=mo_delivery.config`, `error_code=PGRST303`, `handled=yes`. Events: `30392efe…` at 2026-10-28T17:34:20Z (release `0652b769…`) and `432bfcb3…` at 2026-11-03T16:45:40Z (release `78c2ad7d…`). Activity: resolved by the user at 17:39:06Z and 16:47:06Z; a system regression at 16:45:48Z. There are no comments. `search_issues "PGRST303"` over 90 days returns only MO-WEB-8.
- The two dates are a Wednesday and a Tuesday. "Every week" (the user's description) fits the weekly MO run, but Sentry holds only these 2 occurrences.
- One event per incident doesn't prove that MO's retry succeeded. Sentry's Dedupe drops a repeat within the same Worker isolate (`context/foundation/roadmap.md:185`), so a failed retry that hit the same isolate would leave no second event.

### Service-role key and the JWT it produces

- Production uses an `sb_secret_…` key; CI uses the CLI's JWT-format `SERVICE_ROLE_KEY` (`context/archive/2026-09-30-mo-weekly-delivery/reviews/impl-review.md:85,88`). `docs/deployment.md:31` doesn't name the format.
- A legacy `service_role` JWT has a fixed `iat` from project creation, so it couldn't be "issued at future". The error therefore implies that the token PostgREST checks was minted at request time. This is an inference from the error and the key format; no inspected source documents the gateway behaviour.
- Consequence: unlike user sessions (where the risk is "right after sign-in"), every service-role request that reaches PostgREST may carry a freshly minted token. Any service-role PostgREST call could hit this, not only `ingest_weekly_plan`. The other service-role call sites (the auth-link check in `src/lib/services/auth-links.ts`, the keep-alive in `src/worker.ts`) were not checked for PostgREST use in this research.

## Code References

- `src/lib/services/mo-deliveries.ts:46-49` - `configurationFault`: reports `mo_delivery.config`, answers 503
- `src/lib/services/mo-deliveries.ts:109-111,149` - `ingest` closure and its two unwrapped calls
- `src/lib/services/mo-deliveries.ts:153-165` - auth-rejection branch that catches 401 PGRST303
- `src/lib/mo-delivery-faults.ts:12,26-29` - `isAuthRejection`: 401/403 or PGRST301/302
- `src/lib/postgrest-retry.ts:7,18-20,30-45` - retry delays, `isJwtIssuedAtFuture`, `withPgrst303Retry`
- `src/lib/services/plans.ts:25-192`, `src/lib/services/ratings.ts:42` - existing retry call sites
- `src/lib/services/mo-deliveries.test.ts:196-215` - test table for "database rejects the service key" (401+42501, 401 without code, PGRST301); no PGRST303 case
- `docs/mo-delivery-contract.md:123-125,133-137` - MO's 500/503 retry policy, idempotent re-send
- `docs/deployment.md:95` - `mo_delivery.config` step described as "the database or Auth rejects the service-role key"

## Architecture Insights

- Delivery faults fall into three classes: key/configuration (503 + `mo_delivery.config`), storage (500 + `mo_delivery.ingest`/`provision`) and payload/state (400/409, not reported). PGRST303 "issued at future" is a fourth kind, transient and server-side, which today lands in the first class only because of its HTTP status.
- The established pattern for this error is the `withPgrst303Retry` wrapper around a request builder, plus a `console.warn` per retry. The error is reported only if the caller's handling still fails after the retries.

## Historical Context (from prior changes)

- `context/archive/2026-10-04-dashboard-pgrst303-retry/frame.md:27-34` - root cause: PostgREST v14.5 stale time cache; clock skew ruled out (shared clock, 30 s `allowedSkewSeconds`). Production confirmed on 14.5 on 2026-10-04. supabase/supabase#50651 reports the stale value sometimes outlasting a 2 s retry. Still supported; the version hasn't been re-checked since.
- `context/archive/2026-10-04-dashboard-pgrst303-retry/plan.md:33` - non-goal: MO delivery not touched because it uses the "service-role key, not a fresh user JWT". Disproved for production's `sb_secret_…` key by MO-WEB-8.
- `context/archive/2026-10-15-mo-invitation-failure-visible/` - introduced `isAuthRejection`/`configurationFault`. Its review (`reviews/impl-review-phase-1.md:33`) saw that PGRST303 was classified by status but didn't consider the "issued at future" variant.
- `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md:148,167` - D4 recommends mapping PostgREST JWT errors to 503 `not_configured`. W9 asks to map non-"future" PGRST303 to 401 on the user paths. Both remain consistent with treating only the non-"future" variant as a key fault.
- `README.md:46` - "PostgREST is currently v14.5" (local stack pinned via `supabase link`), so a local reproduction is possible but intermittent.

## Related Research

- `context/archive/2026-10-04-dashboard-pgrst303-retry/` (frame, plan, plan-brief): no `research.md`, but the frame holds the root-cause analysis.

## Open Questions

1. Did the affected weeks (2026-10-28, 2026-11-03) reach mo-web through MO's automatic retry, or only through a manual re-POST? This needs MO's logs/Discord or the `weekly_plans` rows for those weeks.
2. Is production PostgREST still v14.5? If Supabase rolls to ≥ v14.18 the retry becomes a no-op, but it can stay.
3. Product choice for a fix: when "issued at future" persists after the retries, should the delivery answer 503 `not_configured` (as now) or 500 `storage_failed`, and under which Sentry step (`mo_delivery.config` vs `mo_delivery.ingest`)? Either way MO retries with backoff (`docs/mo-delivery-contract.md:123-124`).
4. Are the 2 s of in-request retries enough for the service-role path, given supabase/supabase#50651? The delivery has no user waiting, so longer delays are an option (Worker request limits not checked here).
5. Do other service-role PostgREST calls (auth-link check, keep-alive) need the same wrapper? Not inspected.
