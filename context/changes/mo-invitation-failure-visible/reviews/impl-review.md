<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: MO invitation failure visible

- **Plan**: context/changes/mo-invitation-failure-visible/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated criteria re-run on 2026-10-16: `npm test` (375 passed), `npm run lint` (0 errors), `npm run build`, smoke on :4322 (all steps passed, including the `invitation_sent` assertions), `npx prettier --check` on the docs. Manual items 1.3, 2.5–2.8, 3.2, 3.3 are ticked; 3.2/3.3 were checked against `deliveries.ts` in this session. Extras (`docs/deployment.md`, `docs/dev-walkthrough.md`, roadmap status flip, the phase-review fixes) are accepted adaptations.

## Findings

### F1 — `invitation_sent: false` can be lost on a retried delivery

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:153, :188-193; docs/mo-delivery-contract.md:117
- **Detail**: Invite fails, `createUser` succeeds, `mo_delivery.invite` is reported, then the second `ingest()` fails (or the Worker dies) → 500. MO retries, the user now exists, so the 200 is `account_created: false` with no `invitation_sent`. The contract tells MO to alert on `false`, which MO never sees here; only the Sentry warning remains. (`account_created: true` was already lost the same way before this change.)
- **Fix A ⭐ Recommended**: In the contract (and api.md), say `invitation_sent: false` is best-effort and the `mo_delivery.invite` Sentry warning is the authoritative signal.
  - Strength: Two-sentence doc change; matches the plan's "no re-invite, no resend" scope.
  - Tradeoff: MO's alert stays incomplete in a rare double-fault case.
  - Confidence: HIGH — both reviewers traced the same path in the code.
  - Blind spot: None significant.
- **Fix B**: On later deliveries, derive the flag from the user (unconfirmed, `provisioned_by = mo-delivery`, no `invited_at`) and report it.
  - Strength: MO always learns about a never-invited account.
  - Tradeoff: An extra Admin API read for existing users on every delivery; new behaviour outside this plan, untested without the S-02 harness.
  - Confidence: MED — depends on GoTrue exposing `invited_at` reliably.
  - Blind spot: Not verified what GoTrue sets on `createUser` without an invite.
- **Decision**: FIXED via Fix A: contract (note after the check order) and api.md:21 say the flag is best-effort and the `mo_delivery.invite` Sentry warning is the record to rely on

### F2 — Transient invite errors become a permanent "never invited"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:134-153; docs/api.md:21
- **Detail**: Any invite error other than `email_exists` (GoTrue 5xx, status 0, timeout) goes to `createUser` and a non-retried 200 with `invitation_sent: false`; mo-web never invites again. This predates the change (now visible), and the plan chose "failed invitation stays 200". The docs present it only as the rate-limit case.
- **Fix A ⭐ Recommended**: Document that every invite failure, transient ones included, gives `invitation_sent: false` and the warning.
  - Strength: Keeps the plan's decision; the docs then match the code exactly.
  - Tradeoff: A one-off GoTrue blip still needs the user to use "Forgot or never set a password?".
  - Confidence: HIGH — wording only.
  - Blind spot: None significant.
- **Fix B**: For a retryable invite error (status 0 or ≥ 500), return 500 before `createUser` so MO's retry re-attempts the invite.
  - Strength: Transient faults heal on MO's retry.
  - Tradeoff: GoTrue's SMTP failure is also a 500, so a broken mail setup would turn into retried 500s instead of a stored week with the flag — reverses the plan's "failed invitation stays 200" decision.
  - Confidence: LOW — GoTrue's status mapping for invite failures isn't pinned in tests.
  - Blind spot: Not verified whether a failed invite leaves a user behind in every case.
- **Decision**: FIXED via Fix A: contract 200 row and api.md:21 say any invitation failure, transient ones included, gives `invitation_sent: false`

### F3 — GoTrue key-rejection rule lives untested in the route

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/mo/deliveries.ts:14-16, :52-56; src/lib/mo-delivery-faults.ts
- **Detail**: `GOTRUE_KEY_REJECTION_CODES` and `authRejectsKey` (the phase-2 F1 fix) sit in the route with no unit test, while `isAuthRejection`'s docstring still says any 403 is a rejected key. Siblings (`src/lib/auth-errors.ts`) keep classifiers in `src/lib` with tests.
- **Fix**: Move it to `mo-delivery-faults.ts` (e.g. `isGoTrueKeyRejection`), add tests (401 no code → true, 403 `not_admin` → true, 403 other → false), narrow `isAuthRejection`'s docstring to PostgREST.
- **Decision**: FIXED: `isGoTrueKeyRejection` and its code set moved to `src/lib/mo-delivery-faults.ts` with tests (break-check: a plain 403 rule turns 2 tests red); `isAuthRejection` docstring narrowed to PostgREST; route uses it

### F4 — `docs/api.md:21` omits the 503 for a rejected key during provisioning

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: docs/api.md:21
- **Detail**: "If no account can be created at all, the delivery returns 500 `storage_failed`" — a rejected key during invite/createUser answers 503 (stated at api.md:51).
- **Fix**: Append "(503 `not_configured` when Auth rejects the service-role key)".
- **Decision**: FIXED: api.md:21 adds "(503 `not_configured` when Auth rejects the service-role key)"

### F5 — Permanent `createUser` 4xx answers a retryable 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:145-148
- **Detail**: A GoTrue refusal of the address (e.g. `validation_failed`) makes MO retry a request that can never succeed, then alert. Unlikely, since zod validates the email first; the Sentry report makes it visible.
- **Fix**: Accept as is (out of scope); revisit with S-02's delivery tests.
- **Decision**: ACCEPTED: unlikely after zod's email check and visible in Sentry; revisit with S-02's delivery tests

### F6 — `MO_INGEST_TOKEN` reported under step `supabase.config`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/missing-secrets.ts:14; docs/deployment.md (missing-secret bullet)
- **Detail**: The step name reads as Supabase while it now also covers the MO token. Cosmetic unless Sentry filters on `step`.
- **Fix**: Leave as is; the event's code `missing_MO_INGEST_TOKEN` names the variable.
- **Decision**: ACCEPTED: left as is; the code `missing_MO_INGEST_TOKEN` names the variable
