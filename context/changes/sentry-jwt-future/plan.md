# Retry PGRST303 "JWT issued at future" on MO delivery Implementation Plan

## Overview

MO deliveries sometimes get `401 PGRST303 JWT issued at future` from PostgREST. This is hosted PostgREST v14.5's stale-clock bug, which upstream fixed in v14.18. Today the delivery handler treats that 401 as a rejected service-role key: it answers MO with 503 `not_configured` and reports an error-level `mo_delivery.config` event (Sentry MO-WEB-8). Both affected deliveries (2026-10-28, 2026-11-03) got through on MO's own retry, so no week was lost. The problem is the misleading, error-level Sentry signal. This change retries the error inside the request, the same way the page and rating services do. If it still fails after the retries, it becomes a retryable 500 with a quiet warning instead of a key fault.

## Current State Analysis

- `ingest` (`src/lib/services/mo-deliveries.ts:109`) is a closure that builds a new `ingest_weekly_plan` RPC on each call. It runs once (`:111`), and a second time after provisioning an unknown user (`:149`). Neither call is retried.
- After either call, `isAuthRejection({ code, status })` (`src/lib/mo-delivery-faults.ts:70-74`) treats any 401/403 as a rejected key. So PGRST303 goes to `configurationFault` (`mo-deliveries.ts:46-49,153-165`): 503 `not_configured` plus `reportHandledError("mo_delivery.config", …)` at error level.
- `withPgrst303Retry` and `isJwtIssuedAtFuture` (`src/lib/postgrest-retry.ts:7,18-20,30-45`) already exist and run in production for `plans.ts` and `ratings.ts`. The helper makes 3 attempts in total (retries after 500 ms and 1500 ms), writes a `console.warn` line per retry, and then returns the last result unchanged.
- Retrying is safe: PostgREST raises PGRST303 before any SQL runs, and an identical re-send is a no-op anyway (`docs/mo-delivery-contract.md:133-137`).
- Unit tests: `src/lib/services/mo-deliveries.test.ts` has a `stubClient` that always returns one fixed RPC result (`:21-25`). Its "database rejects the service key" table (`:196-215`) has no PGRST303 case. The fake-timer retry test pattern is in `src/lib/services/plans.test.ts:114-138`.

## Desired End State

- A PGRST303 "issued at future" on `ingest_weekly_plan`, on the first call or the post-provisioning call, is retried after 500 ms and 1500 ms. If a retry succeeds, the delivery answers 200 as usual and Sentry gets no event; the Worker log shows only the `ingest_weekly_plan: PGRST303 JWT issued at future, retry n/2 …` warn lines.
- If all 3 attempts fail with "issued at future", the delivery answers 500 `storage_failed` (MO retries with backoff) and reports `mo_delivery.ingest` at level `warning`, grouped under code `PGRST303`.
- A real key rejection (401/403 with any other code, PGRST301/302, or a PGRST303 whose message isn't "issued at future") still answers 503 `not_configured` and reports an error-level `mo_delivery.config` event, with no retry.
- The contract, API and deployment docs describe this, and MO-WEB-8 is resolved by the PR and doesn't come back on the next weekly delivery.

### Key Discoveries:

- One wrap covers both call sites, because `ingest` is the single closure behind them (`mo-deliveries.ts:109`).
- The "issued at future" check has to come **before** `isAuthRejection` (`mo-deliveries.ts:153`), otherwise its 401 status still routes it to `configurationFault`.
- `reportHandledError` already accepts `{ level: "warning" }` and logs warnings with `console.warn` (`src/lib/report-handled-error.ts:62-71`). The code tag comes from the `cause` chain, so the event groups as `mo_delivery.ingest` / `PGRST303`, a new Sentry issue separate from MO-WEB-8.
- MO treats 500 and 503 the same way (retry with backoff, then alert, `docs/mo-delivery-contract.md:123-124`), so MO's code needs no change.

## What We're NOT Doing

- No change to `withPgrst303Retry` or its delays. The delivery reuses 500/1500 ms; if the stale cache lasts longer (supabase/supabase#50651), MO's own backoff covers it.
- Not wrapping the other service-role PostgREST call, `auth_link_is_valid` (`src/lib/services/auth-links.ts:26`). It fails open behind a 2 s abort timeout, and Sentry has no PGRST303 from `auth.link_check` in 90 days.
- No change to `isAuthRejection` itself. The new branch sits in the handler ahead of it, so the classifier's contract (any 401 is a key fault) stays as it is for its other callers.
- No new Sentry step, response code or contract row.
- No change to MO or to the GoTrue (`auth.admin.*`) calls.

## Implementation Approach

Wrap the `ingest` closure in `withPgrst303Retry`. After the calls, add a branch ahead of the auth-rejection check that catches the "issued at future" result left after the retries and routes it to the storage path at warning level. Prove all three outcomes with unit tests (retry succeeds, retries run out, other PGRST303 is still a key fault). Then update the three docs that describe delivery responses and Sentry steps.

## Phase 1: Retry and reclassify in the delivery handler

### Overview

Retry "issued at future" inside the delivery request. If it still fails after the retries, answer 500 `storage_failed` and report a `mo_delivery.ingest` warning; key rejections stay 503 `mo_delivery.config`.

### Changes Required:

#### 1. Delivery handler

**File**: `src/lib/services/mo-deliveries.ts`

**Intent**: Wrap the `ingest` closure so each of its calls retries PGRST303 "issued at future" through the shared helper. Then add a branch, just before the `isAuthRejection` check, that sends a still-failing "issued at future" result to 500 `storage_failed` with a warning-level `mo_delivery.ingest` report, not to `configurationFault`.

**Contract**: `const ingest = () => withPgrst303Retry("ingest_weekly_plan", () => supabase.rpc("ingest_weekly_plan", ingestArgs))`. The new branch is `if (result.error && isJwtIssuedAtFuture(result.error))`. It reports `reportHandledError("mo_delivery.ingest", new Error(\`ingest_weekly_plan failed: ${code} ${message}\`, { cause: result.error }), { level: "warning" })`, using the same message shape as the generic storage branch at `:183-186`, and returns `json({ error: "storage_failed" }, 500)`. The comment on `configurationFault` (`:45`) and the one above the auth check (`:152`) should say that "issued at future" is the transient exception handled first. The report and log carry no email (codes and messages only, as now).

#### 2. Unit tests

**File**: `src/lib/services/mo-deliveries.test.ts`

**Intent**: Let the stub client return a sequence of RPC results. Add tests for the three PGRST303 outcomes, using the fake-timer pattern from `plans.test.ts:114-138`.

**Contract**: `stubClient`/`deliver` accept either one `RpcResult` or an array that is answered in order (the last entry repeats), and existing call sites stay unchanged. New cases in `describe("handleMoDelivery storage")`, where "future" means `{ status: 401, error: { code: "PGRST303", message: "JWT issued at future" } }`:

- future, then success: 200 with `plan_id`, `rpc` called 2×, `reportHandledError` not called, one retry warn line logged.
- future 3×: 500 `storage_failed`, `rpc` called 3×, `reportHandledError` called once with step `mo_delivery.ingest`, options `{ level: "warning" }`, `cause` equal to the RPC error, and a message without the email.
- `{ status: 401, error: { code: "PGRST303", message: "JWT expired" } }`: 503 `not_configured`, `rpc` called 1× (no retry), step `mo_delivery.config`. This case can be a new row in the existing table at `:196-200`, plus an assertion on the `rpc` call count.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the three new PGRST303 cases: `npm test`
- Lint and type-checked rules pass: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Reading the diff confirms the "issued at future" branch sits before the `isAuthRejection` check and both `ingest()` calls go through the wrapped closure

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Docs and rollout check

### Overview

Describe the new behaviour wherever delivery responses and Sentry steps are documented, record the settled unknowns on #203, ship the PR that resolves MO-WEB-8, and check that the next weekly delivery doesn't bring it back.

### Changes Required:

#### 1. MO delivery contract

**File**: `docs/mo-delivery-contract.md`

**Intent**: Tell MO that a transient PostgREST timing rejection that outlasts mo-web's own short retry comes back as 500 `storage_failed`, not 503, and that 503 still means a key or secret problem.

**Contract**: The "Responses and retry policy" table: the 500 row (`:123`) adds that case, the 503 row (`:124`) stays a deploy problem, and one sentence near the table says mo-web retries PGRST303 "JWT issued at future" itself (about 2 s) before answering. MO's action column doesn't change.

#### 2. API reference

**File**: `docs/api.md`

**Intent**: The `POST /api/mo/deliveries` responses line should name the new 500 cause and its warning-level report.

**Contract**: The responses bullet at `:51`: 500 `storage_failed` also covers PGRST303 "JWT issued at future" still failing after 2 in-request retries (reported as a `mo_delivery.ingest` warning). The retry note at `:70` may mention that deliveries retry the same error.

#### 3. Deployment / error monitoring

**File**: `docs/deployment.md`

**Intent**: The Sentry step list should say that `mo_delivery.ingest` can be a warning for PGRST303 "JWT issued at future" still failing after the retries, and that `mo_delivery.config` covers only real key rejections.

**Contract**: The "System faults the app handles" bullet at `:95`, step descriptions for `mo_delivery.ingest` and `mo_delivery.config`.

#### 4. Issue and PR bookkeeping

**Intent**: Record the settled unknowns on #203 and close it, and MO-WEB-8, through the PR.

**Contract**: Comments on #203 that settle its three "Open unknowns": (1) both weeks arrived through MO's retry; (2) the cause is PostgREST v14.5's stale clock on a token minted per request from the `sb_secret_…` key, handled by reusing the 500/1500 ms retry, with MO's backoff covering anything longer; (3) after the retries run out, the delivery answers 500 `storage_failed` with a `mo_delivery.ingest` warning. Tick those boxes and the Definition-of-done boxes as they are met. The PR body contains `Closes #203` and `Fixes MO-WEB-8`.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the docs unchanged: `npx prettier --check docs/mo-delivery-contract.md docs/api.md docs/deployment.md`
- CI on the PR is green (lint, unit tests, smoke, build)

#### Manual Verification:

- #203's open unknowns are answered in comments and ticked
- After merge, MO-WEB-8 shows as resolved by the PR in Sentry
- The next weekly MO delivery raises no new MO-WEB-8 event (a `mo_delivery.ingest` PGRST303 warning, if any, is the expected exhausted-retry signal)

---

## Testing Strategy

### Unit Tests:

- PGRST303 "issued at future" once, then success → 200, no Sentry report.
- PGRST303 "issued at future" on all 3 attempts → 500 `storage_failed`, one `mo_delivery.ingest` warning.
- PGRST303 with another message ("JWT expired") → 503 `not_configured`, `mo_delivery.config`, no retry.
- Existing key-rejection, storage, 22P05 and 409 cases stay green unchanged.

### Integration Tests:

- `npm run smoke` (in CI) covers the delivery happy path. PGRST303 is intermittent and can't be triggered on demand, so the unit tests carry the retry proof.

### Manual Testing Steps:

1. Read the Phase 1 diff: branch order, and both calls going through the wrapped closure.
2. After deploy, watch Sentry around the next weekly MO run for MO-WEB-8 (it shouldn't come back) and for a `mo_delivery.ingest` PGRST303 warning.

## Performance Considerations

An affected delivery waits up to about 2 s longer before it answers. No user waits on it, and MO's HTTP timeout is far above the normal request time.

## Migration Notes

None. No schema or secret changes; deploys with the normal merge-to-master pipeline.

## References

- Research: `context/changes/sentry-jwt-future/research.md`
- Issue: #203; Sentry: MO-WEB-8
- Prior retry change: `context/archive/2026-10-04-dashboard-pgrst303-retry/` (frame, plan)
- Retry helper: `src/lib/postgrest-retry.ts:7-45`; fake-timer test pattern: `src/lib/services/plans.test.ts:114-138`
- Phase sub-issues: Phase 1 #204, Phase 2 #205 (#205 blocked by #204)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Retry and reclassify in the delivery handler

#### Automated

- [x] 1.1 Unit tests pass, including the three new PGRST303 cases: `npm test` — 9694f72
- [x] 1.2 Lint and type-checked rules pass: `npm run lint` — 9694f72
- [x] 1.3 Production build succeeds: `npm run build` — 9694f72

#### Manual

- [x] 1.4 Reading the diff confirms the "issued at future" branch sits before the `isAuthRejection` check and both `ingest()` calls go through the wrapped closure — 9694f72

### Phase 2: Docs and rollout check

#### Automated

- [x] 2.1 Prettier leaves the docs unchanged: `npx prettier --check docs/mo-delivery-contract.md docs/api.md docs/deployment.md`
- [ ] 2.2 CI on the PR is green (lint, unit tests, smoke, build)

#### Manual

- [ ] 2.3 #203's open unknowns are answered in comments and ticked
- [ ] 2.4 After merge, MO-WEB-8 shows as resolved by the PR in Sentry
- [ ] 2.5 The next weekly MO delivery raises no new MO-WEB-8 event (a `mo_delivery.ingest` PGRST303 warning, if any, is the expected exhausted-retry signal)
