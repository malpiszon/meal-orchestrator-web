# MO invitation failure visible — Plan Brief

> Full plan: `context/changes/mo-invitation-failure-visible/plan.md`

## What & Why

When the invitation email can't be sent, the MO delivery route creates the account anyway and answers a plain 200, so a user can get an account nobody told them about and nobody notices (audit finding D1, critical). This change reports that fault to Sentry, tells MO in the response, and fixes three neighbouring blind spots in the same route (D3, D4, D6).

## Starting Point

`POST /api/mo/deliveries` invites the account on an unknown email. If the invite fails it falls back to `createUser`, logs one `console.error` line and answers `account_created: true`. A missing `MO_INGEST_TOKEN` and a wrong service-role key give a silent 503 and a retryable 500. `reportHandledError` and `reportMissingSecrets` already exist from S-08/S-09.

## Desired End State

A failed invitation is a Sentry warning and a 200 with `invitation_sent: false`. A failed account creation is a Sentry error and a retryable 500 without a doomed second RPC. A missing token is reported, and a rejected service-role key answers 503 `not_configured`. The MO contract and API docs describe all of it.

## Key Decisions Made

| Decision                            | Choice                                                                                 | Why (1 sentence)                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Status for a failed invitation      | Stay 200                                                                               | The account and the week are stored; only the invitation is missing.                           |
| Response field                      | `invitation_sent` only when `account_created` is true                                  | Absence means no invitation was attempted, so a routine redelivery never looks like a failure. |
| Sentry level for the invite failure | `warning`, step `mo_delivery.invite`                                                   | The user can recover through "Forgot password", so it isn't data loss.                         |
| Wrong key (D4)                      | HTTP 401/403, `PGRST301`, `PGRST302` → 503 `not_configured`, step `mo_delivery.config` | These can't succeed on retry, and MO already retries and alerts on 503.                        |
| Account creation fails (D6)         | Report `mo_delivery.provision`, 500 `storage_failed`, skip the RPC                     | A later retry may succeed, so it stays retryable.                                              |
| Missing `MO_INGEST_TOKEN` (D3)      | Report once per isolate via `reportMissingSecrets`, body unchanged                     | The check precedes authentication, so the body must not name the secret.                       |
| Where the logic lives               | Pure `isAuthRejection` helper in `src/lib/`                                            | The route has no test harness until S-02, so the decision is unit-tested on its own.           |

## Scope

**In scope:** D1, D3, D4, D6 in the delivery route; the response field; smoke assertions; `docs/mo-delivery-contract.md` and `docs/api.md`.

**Out of scope:** re-inviting or retrying, any user-facing "not invited" indicator, delivery route tests (S-02), changes on the MO side, migrations.

## Architecture / Approach

A pure classifier module plus edits to the one route. `invitation_sent` is set where `accountCreated` is set. Faults go through the existing `reportHandledError`, so Sentry groups them by step and error code and never receives the email.

## Phases at a Glance

| Phase                          | What it delivers                               | Key risk                                               |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| 1. Fault classification helper | `isAuthRejection` with a truth-table unit test | Missing a real PostgREST/GoTrue rejection shape        |
| 2. Wire the delivery route     | D1, D3, D4, D6 behaviour plus smoke assertions | Forcing an invite failure locally for the manual check |
| 3. Docs and contract           | Contract and API docs match the code           | Wording drift from the code                            |

**Prerequisites:** S-08 (done). The branch is `mo-invitation-failure-visible`; no migration, so the shared local Supabase is fine.
**Estimated effort:** ~1–2 sessions across 3 small phases.

## Open Risks & Assumptions

- Assumption: MO ignores unknown JSON fields in a 200 body. This is the roadmap's open unknown (owner: user); the contract doc asks MO to log and alert on `invitation_sent: false`.
- Risk: the exact error shape the Supabase JS client returns for a rejected key may differ per service; Phase 1 covers `status` and the PostgREST codes, and Phase 2 verifies it by hand with a wrong key.

## Success Criteria (Summary)

- A failed invitation is visible in Sentry and in MO's response, with the account and week still stored.
- A wrong key or missing token is a 503 `not_configured`, not a retryable storage failure.
- The contract doc tells the MO side what the new field means.
