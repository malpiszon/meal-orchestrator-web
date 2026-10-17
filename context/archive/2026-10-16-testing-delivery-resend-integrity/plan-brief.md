# Delivery and Re-send Integrity (S-02) — Plan Brief

> Full plan: `context/changes/testing-delivery-resend-integrity/plan.md`
> Research: `context/changes/testing-delivery-resend-integrity/research.md`

## What & Why

MO alerts only on non-2xx, so a delivery answered 200 but stored wrong goes unnoticed (test-plan risk #2), and a re-send that breaks saved choices or other weeks hurts users (risk #6). This change proves a 2xx means the week is stored exactly per `docs/mo-delivery-contract.md`, a failed write leaves the previous week intact, and a re-send changes only its week. Test-plan §3 Phase 2, issue #120.

## Starting Point

The week's writes are one transactional RPC (`ingest_weekly_plan`), but nothing proves rollback. Field mapping is split between TS (zod, `toOptionRows`) and SQL (lookup, column list), and no test crosses both comparing every field; the only fixture has 5 days, two meal types and full fields. Re-send rules are well covered in pgTAP except dropped days/slots and `week_end`/`provider` changes. Several HTTP statuses are untested because the route imports `astro:env`.

## Desired End State

Smoke delivers an edge-case week to a new account and reads every field back as that owner, matching values derived from the contract; a mixed-case email reaches the same account; another user's rows don't move. pgTAP proves a constraint failure mid-write leaves the old week byte-identical, and covers the two missing re-send cases. Vitest pins every non-provisioning status. The contract and PRD describe the shipped re-send behaviour.

## Key Decisions Made

| Decision                 | Choice                                                        | Why (1 sentence)                                                                   | Source   |
| ------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| Atomicity                | Week write is atomic; provisioning is not                     | One `security definer` call; GoTrue sits outside it                                | Research |
| Fixtures                 | Hand-built from the contract (no real dev re-sends)           | Each edge case deliberate, expected values from the contract; settles #120 unknown | Plan     |
| Round trip               | Smoke over HTTP, read back as the owner via PostgREST         | Crosses both TS and SQL halves through the real owner view                         | Plan     |
| Failure paths            | pgTAP rollback + Vitest status mapping (handler moved to lib) | Rollback is cheap in SQL; unit tests reach 500/503 smoke can't                     | Plan     |
| Accounts                 | Mixed-case mapping and other-user isolation only              | S-10 (#145) changes the provisioning branch                                        | Plan     |
| Re-send cases            | Drop a day/slot; change `week_end`/`provider`                 | The realistic changes not yet tested                                               | Plan     |
| Oracle where docs differ | Code is right; fix contract :133 and PRD US-07/FR-017         | Rating-adjusted pick and the 409 were deliberate earlier decisions                 | Plan     |

## Scope

**In scope:**

- Contract and PRD wording fixes
- `delivery_atomicity.test.sql`; two new cases in `week_resubmission.test.sql`
- Handler moved to `src/lib/services/mo-deliveries.ts` (no behaviour change) with unit tests
- `mo-delivery.edge-cases.json` fixture and the smoke round trip
- `docs/testing.md`, test-plan §3/§6.2/§6.5, #120 bookkeeping

**Out of scope:**

- Provisioning/invitation partial states (S-10), new smoke 400/413/503 checks
- `run_id`-only and later-week-stored re-send cases, concurrency
- Any change to `ingest_weekly_plan` or making provisioning atomic

## Architecture / Approach

Cheapest layer first. Expected values always come from the contract, never from `toOptionRows` or the SQL: the smoke derives expected rows with its own helper from the contract's field rules. The handler move is mechanical (token and client injected) so it rebases cleanly against S-10.

## Phases at a Glance

| Phase                                     | What it delivers                                          | Key risk                                                |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| 1. Oracle docs and pgTAP                  | Correct docs, rollback test, two re-send cases            | Constraint cases must fail after the delete, not before |
| 2. Handler move and status unit tests     | Vitest pins 503/401/413/400/409/500/200                   | Merge conflict with S-10 on the same route              |
| 3. Edge-case fixture and smoke round trip | Every field read back as the owner; mixed-case; isolation | Expected-value helper drifting into a copy of the code  |
| 4. Test-plan and docs upkeep              | §6.2 cookbook, testing docs, #120 ticks                   | None significant                                        |

**Prerequisites:** S-01 done (pinned today, contract test); local Supabase, a preview on :4322 for smoke.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- S-10 (#145) edits the same route; whichever merges second rebases onto the other.
- Hand-built fixtures don't prove what MO actually sends; MO's own payload-builder tests cover that side.
- The round trip runs only when `SUPABASE_KEY` is set (CI sets it); locally it prints `SKIP` otherwise.

## Success Criteria (Summary)

- A contract-valid payload stored wrong in any field fails the smoke round trip.
- A write that fails part-way leaves the previous week byte-identical and maps to non-2xx.
- A re-send dropping days/slots or changing week metadata keeps saved choices and touches no other week.
