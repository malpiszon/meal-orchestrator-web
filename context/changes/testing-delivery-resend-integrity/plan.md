# Delivery and Re-send Integrity (S-02) Implementation Plan

## Overview

Test-plan §3 Phase 2 (risks #2 and #6, issue #120): prove that a 2xx from `POST /api/mo/deliveries` means MO's week is stored exactly as `docs/mo-delivery-contract.md` describes, that a failure part-way through the write leaves the previous week intact and answers non-2xx, and that a re-send changes only what it should. This is a test change; the only production edit is moving the route's handler into `src/lib/services/` so Vitest can load it, with no behaviour change.

## Current State Analysis

From `research.md` (same folder):

- The week's writes are one `security definer` call, `ingest_weekly_plan` (`supabase/migrations/20261010120000_warsaw_today_helper.sql:156-287`), so a half-written week behind a 2xx is not possible on the inspected path. No test proves it.
- The realistic risk-#2 failure is "stored wrong", split across a trust boundary: zod + `toOptionRows` in TS (`src/lib/mo-delivery.ts:86-169`), the user lookup and `jsonb_to_recordset` column list in SQL (`warsaw_today_helper.sql:178-183,264-275`). No test crosses both and compares every field.
- The one fixture (`scripts/fixtures/mo-delivery.sample.json`) has 5 days, only `breakfast`/`lunch`, and every variant with full composition and nutrition. pgTAP's option helper never sends `composition`, `nutrition` or `justifications` (`supabase/tests/week_resubmission.test.sql:14-19`). Smoke matches 1–3 names on the dashboard.
- HTTP statuses 400 (non-JSON, schema, `22P05`), 413, 500 (`storage_failed`, `no_plan_id`) and 503 have no test. The route imports `astro:env/server` (`src/pages/api/mo/deliveries.ts:2`), so Vitest can't load it.
- Re-send rules are well covered in pgTAP (`week_resubmission.test.sql`, `date_boundaries.test.sql:242-284`, `rating_ordered_defaults.test.sql:198-245`). Uncovered: a re-send that drops a day or a slot, and one that changes `week_end` or `provider`.
- Docs disagree with shipped behaviour: contract :133 says a never-saved re-send "follows MO's new recommendations", but ingest uses the rating-adjusted suggested pick (`20261008180000_rating_ordered_defaults.sql:49-95`, `docs/api.md:76-97`); PRD US-07 / FR-017 (`context/foundation/prd.md:118-122,192`) say the latest delivery always replaces the stored one, but a changed re-send of a started week answers 409.

## Desired End State

- A smoke step delivers an edge-case fixture to a new email, reads the stored plan back as that account through PostgREST, and compares every field with values derived from the fixture by the contract's rules; a mixed-case re-delivery reaches the same account; the smoke user's rows are unchanged.
- A pgTAP test makes ingest fail after it has updated the plan row and deleted its options, and proves the previous week (plan, options, choices, `saved_at`) is byte-identical.
- pgTAP covers a re-send that drops a day and a slot, and one that changes `week_end` and `provider`.
- Vitest covers every status the endpoint answers except the provisioning branch, against the contract's Responses table.
- The contract and the PRD describe the shipped re-send behaviour; test-plan §3 row 2, §6.2 and §6.5 and `docs/testing.md` describe the new tests.

Verify: `npm test`, `npx supabase test db`, `npm run smoke` (with `SUPABASE_KEY` set), `npm run lint`, `npx astro check` all pass; CI's `ci` and `smoke` jobs are green.

### Key Discoveries:

- Owner read pattern in pgTAP: deliver as `service_role`, read as `authenticated` with `request.jwt.claims` (`week_resubmission.test.sql:163-164`); `pg_temp.state()` snapshots every row except one plan's (`:50-60`).
- DB guards that can raise after the update and delete: `score between 1 and 10`, `unique (plan_id, meal_date, meal_type, variant_index)`, `not null name` (`20261001120000_weekly_plans.sql:25-33`).
- Smoke already has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required) and `SUPABASE_KEY` (optional, prints `SKIP` without it) (`scripts/smoke.mjs:198-252`); `loadDelivery` shifts a fixture to a Monday (`:168-180`). CI sets all three.
- The post-deploy probe is plain `curl` in `.github/workflows/ci.yml:~210-220`, not `smoke.mjs`, so new smoke steps never run against production.
- `report-handled-error.ts` imports `@sentry/cloudflare` and already has a Vitest file, so a handler that calls it is unit-testable.
- S-10 (#145, open) edits the provisioning branch of the same route.

## What We're NOT Doing

- Real dev re-sends as fixtures (decided: hand-built from the contract; answers #120's open unknown).
- Provisioning and invitation partial states (F2, F3, `provisioned_by`, the `createUser` fallback): S-10 changes that branch. Unit tests stub the RPC so it never answers `unknown_user`.
- New smoke checks for 400/413/503: the unit tests cover the status mapping.
- Re-send cases for a `run_id`-only change and for a later week being stored (the existing `state()` snapshot covers other weeks).
- Concurrent deliveries (fixed and reviewed in the archive; not a regression risk here).
- Making provisioning atomic, or any change to `ingest_weekly_plan`.
- Asserting the dashboard rendering of the round trip (the owner's rows are the oracle; rendering is e2e/smoke territory already).

## Implementation Approach

Cheapest layer first. Phase 1 fixes the oracle documents, then adds pgTAP for atomicity and the two re-send cases. Phase 2 moves the handler and unit-tests the status mapping. Phase 3 adds the cross-boundary round trip in smoke. Phase 4 records the patterns. Expected values always come from the contract (`test-plan.md` §1), never from `toOptionRows` or the SQL.

## Critical Implementation Details

- **Handler move vs S-10.** Keep the Phase 2 move mechanical (same order of checks, same messages, same reporting) so a rebase against S-10's provisioning edits is a straight conflict resolution; whichever branch merges second moves or re-applies the other's change.
- **Round-trip expectations.** The smoke helper that derives expected rows must be written from the contract table, not by porting `toOptionRows`: `""` composition → `null`, a missing `nutrition` → `null`, unknown nested keys absent from columns but present in `raw_payload`, `variant_index` = position in the array, `is_recommended` = highest score with ties to the first listed.

## Phase 1: Oracle docs and pgTAP

### Overview

Correct the two stale documents so later assertions have a right oracle, then prove atomicity and the two uncovered re-send cases in pgTAP.

### Changes Required:

#### 1. Contract re-send wording

**File**: `docs/mo-delivery-contract.md`

**Intent**: The "Upcoming week: replaced" rule says a never-saved re-send follows MO's new recommendations; it follows the suggested pick (MO's score adjusted by the user's ratings), and a kept dish that is gone also falls back to the suggested pick.

**Contract**: The Idempotency bullet "Upcoming week: replaced" and the 200 row of the Responses table; link to `docs/api.md#re-delivery`.

#### 2. PRD re-send wording

**File**: `context/foundation/prd.md`

**Intent**: US-07 and FR-017 say the latest delivery always replaces the stored week; add that a changed re-send of a started week is refused and that saved choices are kept (FR-018), as a dated update note like the existing one.

**Contract**: US-07 Then/Acceptance Criteria and FR-017's update note.

#### 3. Atomicity test

**File**: `supabase/tests/delivery_atomicity.test.sql` (new)

**Intent**: Deliver an upcoming week, save it with a swap, then re-send a changed body whose options fail a table constraint after the update and delete (one case each: a score of 11, a duplicate `(date, type, variant_index)`, a `null` name). Assert the call throws and that the plan row, every option row, the chosen option and `saved_at` equal a snapshot taken before.

**Contract**: Uses its own `pg_temp` helpers (copied in shape from `week_resubmission.test.sql`, with the real Warsaw today; no date boundary is involved). Header comment states risk #2 and the contract line it pins ("a failure leaves nothing half-written").

#### 4. Re-send cases

**File**: `supabase/tests/week_resubmission.test.sql`

**Intent**: Add (a) a saved upcoming week re-sent without one day and without one slot of another day: the dropped rows are gone, every remaining kept choice survives, each slot still has exactly one chosen option, and `saved_at` is unchanged; (b) a re-send that changes `week_end` (+4 → +6) and `provider`: the plan row carries the new values, choices are kept by `provider_meal_id`, the plan stays saved. Other weeks and users stay byte-identical via `state()`.

**Contract**: Bump `plan(36)` to the new count; expected values cite contract Idempotency and `docs/api.md` Re-delivery.

### Success Criteria:

#### Automated Verification:

- Database tests pass with full output logged: `npx supabase test db > pgtap.log 2>&1` in a scratch directory (lessons: never piped through `tail`)
- The atomicity test's snapshot catches a changed week: making the failing option valid (spot-check, then revert) turns its comparison red
- Lint and format pass: `npm run lint`, `npx prettier --check docs context/foundation/prd.md`

#### Manual Verification:

- The contract and PRD wording reads as the shipped behaviour (compare with `docs/api.md` Re-delivery)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Handler move and status-mapping unit tests

### Overview

Make the route's logic loadable by Vitest and pin every non-provisioning status against the contract's Responses table.

### Changes Required:

#### 1. Handler module

**File**: `src/lib/services/mo-deliveries.ts` (new)

**Intent**: Move the body of `POST` (configuration check through the 200 response, helpers `json`, `tokensMatch`, `bearerToken`, `logStorageError` and the constants) here unchanged; the only difference is that the token and the service client arrive as arguments.

**Contract**: `handleMoDelivery(request: Request, deps: { token: string | undefined; supabase: SupabaseClient | null }): Promise<Response>`. No `astro:env` import.

#### 2. Thin route

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: Keep `prerender = false` and an uppercase `POST` that reads `MO_INGEST_TOKEN` from `astro:env/server`, calls `createServiceClient()` and returns `handleMoDelivery(...)`.

**Contract**: Route path and behaviour unchanged.

#### 3. Unit tests

**File**: `src/lib/services/mo-deliveries.test.ts` (new)

**Intent**: With a stub client whose `rpc` returns scripted `{ data, error }`, and `reportHandledError` mocked, assert status and body for: 503 (no client, no token); 401 (missing, malformed, wrong token); 413 (by `Content-Length`, and by real byte length with a lying header); 400 non-JSON (`path: ""`); 400 schema (issue paths, e.g. `days.0.meals.0.type`); 400 for RPC `22P05`; 409 for `55000 week_started`; 500 `storage_failed` for another `55000` message and for any other error (reported); 500 for a non-string plan id (reported with `no_plan_id`); 200 `{plan_id, week_start, account_created: false}`. Also assert the RPC was not called for 4xx-before-storage cases, and that `p_raw` is the body as received (an unknown nested key is present) and `p_run_id` is `null` when `run_id` is absent.

**Contract**: Expected statuses and bodies come from `docs/mo-delivery-contract.md` Responses; the stub never returns `P0002 unknown_user` (provisioning is S-10's).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- The existing smoke still passes unchanged: `npm run smoke` against a preview on :4322

#### Manual Verification:

- `git diff` of the moved code shows only the dependency-injection change (no reordered checks or new messages)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Edge-case fixture and smoke round trip

### Overview

Cross the TS→SQL boundary end to end: deliver a payload full of contract edge cases over HTTP and read it back as its owner.

### Changes Required:

#### 1. Edge-case fixture

**File**: `scripts/fixtures/mo-delivery.edge-cases.json` (new)

**Intent**: A contract-valid week built from the contract's field rules: 7 days (`week_end = week_start + 6`), all six meal types across the week, one meal with 10 variants and a score tie at the top, an empty `composition`, a variant without `nutrition`, a partial `nutrition`, a `nutrition` with an unknown key, 0 and 5 justifications, an unknown key on `user`, a day, a meal and a variant, and a `run_id`. Short names; dates are placeholders shifted by `loadDelivery`.

**Contract**: Passes `moDeliverySchema` (asserted in `src/lib/mo-delivery.test.ts` next to the sample).

#### 2. Smoke round trip

**File**: `scripts/smoke.mjs`

**Intent**: New steps, run when `SUPABASE_KEY` is set (else `SKIP  delivery round trip (set SUPABASE_KEY)`): snapshot the smoke user's plans and options through its own session; deliver the edge-case fixture to a new email (200, `account_created: true`); set that account's password through the Admin API and sign in with the password grant; read `weekly_plans` with `plan_meal_options(*)` as that user; compare plan fields (`provider`, `week_start`, `week_end`, `mo_run_id`, `raw_payload` deep-equal to the body sent) and every option (date, type, `variant_index`, `provider_meal_id`, `name`, `composition`, `nutrition`, `score`, `justifications`, `is_recommended`) with expectations derived from the fixture by the contract rules; deliver another week for the same address in mixed case and assert `account_created: false` and that the owner now reads two plans; finally re-read the smoke user's rows and assert they are unchanged.

**Contract**: A local `expectedOptions(delivery)` helper derived from the contract table, not from `src/lib/mo-delivery.ts`. Failures print the first differing field path.

#### 3. Schema test for the fixture

**File**: `src/lib/mo-delivery.test.ts`

**Intent**: The edge-case fixture is accepted, so a contract change that invalidates it fails in Vitest before smoke.

**Contract**: One `it` next to the sample's.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Smoke passes with all variables set, including the round-trip steps: `npm run smoke` against a preview on :4322
- The round trip fails when a column is dropped from the RPC's `jsonb_to_recordset` list (spot-check locally on a scratch migration, then revert with `npx supabase db reset`)
- Lint passes: `npm run lint`
- CI `smoke` job green on the PR

#### Manual Verification:

- The round-trip step output lists the fields compared and reads clearly on failure

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Test-plan and docs upkeep

### Overview

Record the patterns so the next contributor adds delivery tests the same way.

### Changes Required:

#### 1. Testing docs

**File**: `docs/testing.md`

**Intent**: Describe the round-trip steps and that `SUPABASE_KEY` enables them; mention the new pgTAP file and the handler unit tests.

**Contract**: The smoke section and its variable table (`SUPABASE_KEY` row).

#### 2. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: §3 row 2 → `complete` with the change folder; §6.2 cookbook: a new contract field goes into the edge-case fixture, `expectedOptions` and the schema test; a new status goes into `mo-deliveries.test.ts`; a re-send rule goes into `week_resubmission.test.sql` with `state()`; a new write step keeps the atomicity test's constraint cases valid. §6.5 Phase 2 note: the handler move, the stale docs fixed, provisioning left to S-10. Bump "Last updated".

**Contract**: §3 table, §6.2, §6.5.

#### 3. Issue bookkeeping

**File**: GitHub #120

**Intent**: Tick the "Test-plan §3 row 2 and §6.2" DoD box (the fixtures unknown was resolved and commented at planning).

**Contract**: Issue checkboxes and one comment.

### Success Criteria:

#### Automated Verification:

- Format check passes: `npx prettier --check docs context`

#### Manual Verification:

- §6.2 is enough to add a test for a new contract field without reading this plan

---

## Testing Strategy

### Unit Tests:

- Status mapping of the moved handler (Phase 2) and schema acceptance of the edge-case fixture (Phase 3).

### Integration Tests:

- pgTAP: rollback after a constraint failure; re-send dropping a day and a slot; re-send changing `week_end` and `provider`.
- Smoke: HTTP → RPC → owner read of every field; mixed-case email to the same account; another user unchanged.

### Manual Testing Steps:

1. Read the changed contract and PRD paragraphs against `docs/api.md` Re-delivery.
2. Review the diff of the handler move for behaviour changes.
3. Break one stored column locally and confirm the round trip names it.

## Performance Considerations

Smoke grows by a few requests (one delivery of ~7 days, one sign-in, three reads); negligible against the job's ~3 minutes.

## Migration Notes

None: no schema change. The handler move ships with the normal deploy; no deploy-order step.

## References

- Research: `context/changes/testing-delivery-resend-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (#2, #6), §3 row 2, §6.2
- Issue: #120; phase sub-issues #179 (Phase 1), #180 (Phase 2), #181 (Phase 3), #182 (Phase 4)
- Contract: `docs/mo-delivery-contract.md` (Fields, Responses, Idempotency)
- Re-send pgTAP pattern: `supabase/tests/week_resubmission.test.sql`
- Route: `src/pages/api/mo/deliveries.ts:57-172`
- S-10 overlap: #145

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Oracle docs and pgTAP

#### Automated

- [x] 1.1 Database tests pass with full output logged — 79e3870
- [x] 1.2 Atomicity snapshot catches a changed week (spot-check, reverted) — 79e3870
- [x] 1.3 Lint and format pass — 79e3870

#### Manual

- [x] 1.4 Contract and PRD wording reads as the shipped behaviour — 79e3870

### Phase 2: Handler move and status-mapping unit tests

#### Automated

- [x] 2.1 Unit tests pass — 74e80e0
- [x] 2.2 Type check passes — 74e80e0
- [x] 2.3 Lint passes — 74e80e0
- [x] 2.4 Existing smoke still passes unchanged — 74e80e0

#### Manual

- [x] 2.5 Handler move diff shows only the dependency-injection change — 74e80e0

### Phase 3: Edge-case fixture and smoke round trip

#### Automated

- [ ] 3.1 Unit tests pass
- [ ] 3.2 Smoke passes including the round-trip steps
- [ ] 3.3 Round trip fails when a stored column is dropped (spot-check, reverted)
- [ ] 3.4 Lint passes
- [ ] 3.5 CI smoke job green on the PR

#### Manual

- [ ] 3.6 Round-trip output lists compared fields and reads clearly on failure

### Phase 4: Test-plan and docs upkeep

#### Automated

- [ ] 4.1 Format check passes

#### Manual

- [ ] 4.2 §6.2 is enough to add a test for a new contract field
