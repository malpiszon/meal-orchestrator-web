# MO invitation failure visible Implementation Plan

## Overview

A failed invitation (or a failed account creation, or a wrong service-role key) in `POST /api/mo/deliveries` is today a `console.error` line or a misleading 500. This plan reports each of those faults to Sentry through `reportHandledError`, tells MO about a missing invitation with a new `invitation_sent` response field, and answers a wrong key with the existing 503 `not_configured` instead of a retryable 500. Roadmap S-10, issue #145, audit findings D1, D3, D4, D6.

## Current State Analysis

- `src/pages/api/mo/deliveries.ts:111-138`: on `unknown_user` the route calls `inviteUserByEmail`. If that fails with anything but `email_exists`, it logs (`logStorageError`), calls `createUser` without an invitation, sets `accountCreated = !createError` and re-runs the RPC. The 200 body is `{plan_id, week_start, account_created}`, so MO sees plain success (D1).
- `deliveries.ts:132-136`: when `createUser` fails too, the route still re-runs the RPC, which fails with `unknown_user` and is reported as `mo_delivery.ingest`, with the real auth error only in an earlier unlinked log line (D6).
- `deliveries.ts:59-62`: a missing `MO_INGEST_TOKEN` answers 503 with no event. A missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` is already reported once per isolate by `createServiceClient` through `reportMissingSecrets` (`src/lib/supabase.ts:32`, `src/lib/missing-secrets.ts`), so only `MO_INGEST_TOKEN` is a gap (D3).
- `deliveries.ts:155-161`: any RPC error that is not a known code becomes reported 500 `storage_failed`, which MO retries. A present but wrong service-role key is rejected by PostgREST (HTTP 401/403, `PGRST301`/`PGRST302`) and lands here (D4).
- `reportHandledError(step, error, {level, code})` (`src/lib/report-handled-error.ts`) groups by step and code, masks emails in the log line and tags, and supports `warning`.
- The route has no unit test yet (S-02 adds delivery tests). This slice puts its decision logic in a testable `src/lib` module and does not add a route test harness.
- Docs that describe the current behaviour: `docs/mo-delivery-contract.md:117,123,124`, `docs/api.md:21,50`.

## Desired End State

- A failed invitation produces one Sentry warning grouped as `mo_delivery.invite` + the GoTrue error code, no email in it. The delivery still stores the account and the week and answers 200 with `account_created: true, invitation_sent: false`.
- A successful invitation answers 200 with `invitation_sent: true`. A delivery for an existing user answers 200 without the field.
- If the account cannot be created at all, Sentry gets `mo_delivery.provision` + the auth error code, the RPC is not re-run, and MO gets 500 `storage_failed` (retryable).
- A missing `MO_INGEST_TOKEN` is reported once per isolate (`missing_MO_INGEST_TOKEN`), still answering 503 `not_configured`.
- A service-role key that PostgREST or GoTrue rejects (HTTP 401/403, `PGRST301`, `PGRST302`) is reported as `mo_delivery.config` and answers 503 `not_configured`, not 500.
- `docs/mo-delivery-contract.md` and `docs/api.md` describe the new field and the 503 cases.

### Key Discoveries:

- `inviteUserByEmail` failing leaves a created, unconfirmed user: later deliveries find the user and never re-invite (`deliveries.ts:111`), which is why the failure must be visible at the time it happens.
- MO already retries 503 and alerts after retries (`docs/mo-delivery-contract.md:124`), so mapping D4 to 503 needs no MO change. The new response field is additive JSON.
- `reportMissingSecrets` already dedupes per isolate and sends only the variable name; reuse it for `MO_INGEST_TOKEN`.
- Sentry events from `reportHandledError` are masked for emails in the message and tags, but the GoTrue error message can quote the address: the helper's `maskEmails` already covers it, so pass the real error as the cause.

## What We're NOT Doing

- Re-inviting a user, a retry or resend endpoint, or any user-facing indicator of "not invited" (parked in the roadmap).
- Changing the 200 status for a failed invitation: the account and the week are stored, so it stays a success with a flag.
- Naming the missing secret in the 503 body (the check runs before authentication); Sentry carries the name.
- Mapping other 4xx PostgREST errors to 503; only authentication rejections.
- Delivery route tests with a fake Supabase client (S-02), and any migration.
- Changing MO; whether MO alerts on `invitation_sent: false` is a note in the contract doc for the MO side.

## Implementation Approach

Move the two classification decisions into a pure module so they are unit-tested, then wire the route, then update the docs. The route keeps its order of steps. `invitation_sent` is set only on the `accountCreated` path.

## Phase 1: Fault classification helper

### Overview

A pure, unit-tested module that decides "is this error an authentication rejection" so the route and the tests share one definition.

### Changes Required:

#### 1. Classifier

**File**: `src/lib/mo-delivery-faults.ts` (new)

**Intent**: Decide whether an error from PostgREST or GoTrue means the service-role key is wrong or rejected, as opposed to a storage fault.

**Contract**: `isAuthRejection(error: { code?: string; status?: number; message?: string } | null | undefined): boolean`, true for `status` 401 or 403, or `code` `PGRST301` / `PGRST302` (PostgREST JWT errors). False for everything else, including `unknown_user`, `22P05`, `55000` and plain `storage` errors.

#### 2. Unit tests

**File**: `src/lib/mo-delivery-faults.test.ts` (new)

**Intent**: Pin the mapping, including the boundary that other 4xx and Postgres codes are not auth rejections.

**Contract**: Vitest cases for 401, 403, `PGRST301`, `PGRST302` (true) and 400, 404, 500, `P0002`, `22P05`, `55000`, undefined `status`, `null` (false).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Linting and types pass: `npm run lint`

#### Manual Verification:

- The mapping matches the cases listed in Key Discoveries and the roadmap outcome (a wrong key is not a retryable storage failure)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Wire the delivery route

### Overview

Report the invitation, provisioning and configuration faults and change the responses as decided.

### Changes Required:

#### 1. Invitation outcome (D1)

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: Make a failed invitation visible to Sentry and to MO while still storing the account and week.

**Contract**: On `inviteUserByEmail` success set `invitationSent = true`. On the fallback path (not `email_exists`), call `reportHandledError("mo_delivery.invite", inviteError, { level: "warning" })` in place of `logStorageError("inviteUserByEmail", …)`, and leave `invitationSent = false`. The 200 body is `{plan_id, week_start, account_created, invitation_sent}` with `invitation_sent` present only when `account_created` is true (existing users and the concurrent-delivery `email_exists` race omit it).

#### 2. Provisioning failure (D6)

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: When no user could be produced, say so and skip the doomed second RPC.

**Contract**: If `createUser` fails with a code outside `EMAIL_EXISTS_CODES`, call `reportHandledError("mo_delivery.provision", createError)` and return 500 `{error: "storage_failed"}` without calling `ingest()` again. An `email_exists` result still falls through to the retry (the concurrent-delivery case). If the failed `createUser` is an auth rejection (Phase 1), it follows the D4 path below.

#### 3. Missing token (D3)

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: Make a missing `MO_INGEST_TOKEN` visible once per isolate.

**Contract**: When `MO_INGEST_TOKEN` is empty, call `reportMissingSecrets(["MO_INGEST_TOKEN"])` before the existing 503 `{error: "not_configured"}`. The body is unchanged.

#### 4. Wrong key (D4)

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: A key the services reject can never succeed on retry, so answer it as a configuration fault.

**Contract**: For the RPC result, the `inviteUserByEmail` error and the `createUser` error, if `isAuthRejection(error)` return 503 `{error: "not_configured"}` after `reportHandledError("mo_delivery.config", error)`, before the existing 400/409/500 mapping.

#### 5. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Keep the smoke test covering the new-account delivery with the new field.

**Contract**: The existing new-user delivery step also asserts `invitation_sent === true` (local email is not rate limited, see memory note) and that a redelivery to an existing user has no `invitation_sent` key.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Linting and types pass: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke passes on the preview port: `ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4322` then `BASE_URL=http://localhost:4322 npm run smoke`

#### Manual Verification:

- With the local stack, a delivery for a new email answers `invitation_sent: true` and an invitation lands in Mailpit
- With the service-role key altered in `.dev.vars`, a delivery answers 503 `not_configured` and the dev server logs a `mo_delivery.config` line
- With `MO_INGEST_TOKEN` removed, a delivery answers 503 and the log shows `missing_MO_INGEST_TOKEN` once
- Forcing the invite to fail (for example by stopping the mail service in the local stack, or pointing `SUPABASE_URL` at a stub) shows a `mo_delivery.invite` warning and a 200 with `invitation_sent: false`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Docs and contract

### Overview

Bring the MO contract and API docs in line with the new behaviour.

### Changes Required:

#### 1. MO contract

**File**: `docs/mo-delivery-contract.md`

**Intent**: Tell the MO side about the new field and the changed 503 meaning.

**Contract**: In the Responses table, the 200 row lists `invitation_sent` (present only with `account_created: true`; `false` means the account and week are stored but no invitation was sent, the user can use "Forgot or never set a password?"), and replace "a failed email is only logged and doesn't change the response". The 503 row says it also covers a service-role key mo-web's database or auth rejects. Add a short MO-side note: log `invitation_sent: false` and alert the operator, since mo-web will not re-invite. Update the check-order sentence if it changes.

#### 2. API reference

**File**: `docs/api.md`

**Intent**: Describe the current rules.

**Contract**: Update the account paragraph (line ~21: the failure is now reported to Sentry and flagged in the response) and the MO delivery Responses bullet (line ~50: 200 body with `invitation_sent`; 500 and 503 meanings).

### Success Criteria:

#### Automated Verification:

- Formatting passes: `npx prettier --check docs/mo-delivery-contract.md docs/api.md`

#### Manual Verification:

- The docs state the same field name, presence rule and status codes as the code
- No doc still says the invitation failure is "only logged"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `isAuthRejection` truth table (Phase 1).
- The route itself has no unit test; S-02 adds the delivery harness. This plan's route behaviour is covered by the smoke assertions and the manual checks.

### Integration Tests:

- Smoke: new-user delivery has `invitation_sent: true`; an existing user's redelivery omits it.

### Manual Testing Steps:

1. Deliver for a new email on the local stack and check the response and Mailpit.
2. Break the service-role key, then remove `MO_INGEST_TOKEN`, and check the 503s and the log lines.
3. Force an invitation failure and check the warning and `invitation_sent: false`.

## Performance Considerations

None: the added calls are in-memory classification and a Sentry capture on failure paths.

## Migration Notes

No migration. The new response field is additive; the 500 → 503 change for rejected keys affects only a misconfigured deploy. The Sentry events need no setup beyond the existing DSN. Deploy order: no database or dashboard step.

## References

- Roadmap item: `context/foundation/roadmap.md` § S-10, issue #145
- Audit: `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §5 (D1, D3, D4, D6), §6
- Route: `src/pages/api/mo/deliveries.ts:111-161`
- Helpers: `src/lib/report-handled-error.ts`, `src/lib/missing-secrets.ts`, `src/lib/supabase.ts:30-37`
- Docs: `docs/mo-delivery-contract.md:113-127`, `docs/api.md:21,43-52`
- Phase sub-issues: #163, #164, #165

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fault classification helper

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 744c490
- [x] 1.2 Linting and types pass: `npm run lint` — 744c490

#### Manual

- [x] 1.3 The mapping matches the cases listed in Key Discoveries and the roadmap outcome (a wrong key is not a retryable storage failure) — 744c490

### Phase 2: Wire the delivery route

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 781fe79
- [x] 2.2 Linting and types pass: `npm run lint` — 781fe79
- [x] 2.3 Production build succeeds: `npm run build` — 781fe79
- [x] 2.4 Smoke passes on the preview port: `ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4322` then `BASE_URL=http://localhost:4322 npm run smoke` — 781fe79

#### Manual

- [x] 2.5 With the local stack, a delivery for a new email answers `invitation_sent: true` and an invitation lands in Mailpit — 781fe79
- [x] 2.6 With the service-role key altered in `.dev.vars`, a delivery answers 503 `not_configured` and the dev server logs a `mo_delivery.config` line — 781fe79
- [x] 2.7 With `MO_INGEST_TOKEN` removed, a delivery answers 503 and the log shows `missing_MO_INGEST_TOKEN` once — 781fe79
- [x] 2.8 Forcing the invite to fail (for example by stopping the mail service in the local stack, or pointing `SUPABASE_URL` at a stub) shows a `mo_delivery.invite` warning and a 200 with `invitation_sent: false` — 781fe79

### Phase 3: Docs and contract

#### Automated

- [x] 3.1 Formatting passes: `npx prettier --check docs/mo-delivery-contract.md docs/api.md` — 6fea68c

#### Manual

- [x] 3.2 The docs state the same field name, presence rule and status codes as the code — 6fea68c
- [x] 3.3 No doc still says the invitation failure is "only logged" — 6fea68c
