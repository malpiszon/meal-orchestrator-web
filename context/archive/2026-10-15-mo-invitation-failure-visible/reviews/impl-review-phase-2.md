<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: MO invitation failure visible

- **Plan**: context/changes/mo-invitation-failure-visible/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
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

Evidence: commit 781fe79 implements all five planned changes (D1, D6, D3, D4 and the smoke assertions) and the queued phase-1 fix F1. The F1 call site builds `{ code, status }` instead of spreading, because eslint's `no-misused-spread` rejects the spread; `isAuthRejection` reads only those two fields, so the result is the same. Nothing from "What We're NOT Doing" was touched, and the docs are left for Phase 3. Re-run at review: `npm test` 375/375, `npm run lint` 0 errors (2 warnings already in `report-handled-error.ts`), `npm run build` OK. Smoke passed on :4322 during implementation, and the break-check turned both new assertions red. The manual checks 2.5–2.8 were run against a local preview with edited `dist/server/.dev.vars` and an invite-failing proxy: 200 with `invitation_sent: true` plus a Mailpit invite; 503 with `mo_delivery.config` / `PGRST301` for the anon key and for a garbage key; 503 twice with one `missing_MO_INGEST_TOKEN` line; 200 with `invitation_sent: false` plus a `mo_delivery.invite` warning, the user unconfirmed and never invited. No email or key reaches the logs or Sentry: GoTrue errors are Errors whose messages `scrubEvent` masks, and the PostgREST error travels only as a `cause`.

## Findings

### F1 — Any GoTrue 403 is now treated as a rejected key

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:126, :145 (classifier src/lib/mo-delivery-faults.ts:20-24)
- **Detail**: `isAuthRejection` treats every 401/403 as a bad key, so a 403 from `inviteUserByEmail` or `createUser` returns 503 `not_configured` before anything is stored. MO retries 503 and then alerts on configuration. GoTrue's key rejections (`bad_jwt`, `not_admin`, `no_authorization`, observed as 403 in the phase-1 probes) are covered. But if GoTrue answers 403 for a reason tied to the email or the project rather than the key, that email's deliveries would fail for good with a misleading alert. Before this change, an invite failure fell through to `createUser` and the week was stored. Whether GoTrue's admin invite or create ever returns such a 403 is not verified.
- **Fix A ⭐ Recommended**: At the two GoTrue call sites, count a 403 as a configuration fault only when `code` is `bad_jwt`, `not_admin` or `no_authorization`; 401 always counts. The RPC check stays as it is.
  - Strength: It catches exactly the wrong-key shapes observed locally, and every other GoTrue error keeps its old path (invite → createUser fallback; createUser → provision 500).
  - Tradeoff: The route holds a small GoTrue code list, and a future GoTrue key-error code would degrade to the old behaviour (a retryable 500, still reported).
  - Confidence: MED — the codes come from the phase-1 probes; hosted GoTrue wasn't probed.
  - Blind spot: Hosted GoTrue's exact body for a bad service key.
- **Fix B**: Keep it as is and record "GoTrue 403 = key only" as a checked assumption in the issue's open unknowns, after reading GoTrue's admin handlers.
  - Strength: No code change, and a single classifier.
  - Tradeoff: It relies on reading GoTrue source that can change.
  - Confidence: LOW — the GoTrue source hasn't been checked yet.
  - Blind spot: GoTrue versions differ between local and hosted.
- **Decision**: FIXED via Fix A: `authRejectsKey()` in deliveries.ts (any 401, or a 403 with `bad_jwt`/`not_admin`/`no_authorization`); the RPC check is unchanged

### F2 — The concurrent-delivery race sends a false "invitation failed" warning

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/mo/deliveries.ts:134-139
- **Detail**: When two deliveries arrive at once for a new email, the loser's invite gets GoTrue's generic 500 and is reported as `mo_delivery.invite` before `createUser` answers `email_exists`. The response is correct (200 without `invitation_sent`), but Sentry shows an invitation failure for a user whose invitation the winner sent. If the winner's invite failed, the winner reports it itself.
- **Fix**: Report `mo_delivery.invite` only after `createUser` has succeeded, i.e. when this delivery created the account without an invitation. Skip it when `createUser` answers `email_exists`.
- **Decision**: FIXED: the `mo_delivery.invite` warning now follows `createUser` and is sent only when `accountCreated`

### F3 — A failed `provisioned_by` stamp is still console-only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:133
- **Detail**: When `updateUserById` fails after a successful invite, the user has no `provisioned_by`, and the failure is only `logStorageError`, which prints an unmasked message. This code is unchanged and outside the plan, but it is the one fault on this path that stays invisible, and `logStorageError` has no other caller left.
- **Fix**: `reportHandledError("mo_delivery.provision", metadataError, { level: "warning" })` and remove `logStorageError` and `DbError`.
- **Decision**: FIXED: `updateUserById` failure reported as a `mo_delivery.provision` warning; `logStorageError` and `DbError` removed

### F4 — The missing token is reported as a "Supabase secret"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/mo/deliveries.ts:70, src/lib/missing-secrets.ts:14
- **Detail**: `reportMissingSecrets(["MO_INGEST_TOKEN"])` reports under step `supabase.config` with "Supabase secret not configured: MO_INGEST_TOKEN". Grouping (`missing_MO_INGEST_TOKEN`) and once-per-isolate dedupe are right; only the title and the step facet are misleading.
- **Fix**: Make the helper's wording generic ("Secret not configured: …") and keep the step `supabase.config`, or rename the step to `config` (check Sentry alert rules on the step first).
- **Decision**: FIXED: the message is now "Secret not configured: <NAME>" (missing-secrets.ts and its test); the step stays `supabase.config`

### F5 — The wrapper message prints "undefined" when the RPC error has no code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/mo/deliveries.ts:159-169
- **Detail**: For a code-less 401 (the probable hosted shape), the message reads `rejected the key: 401 undefined Invalid API key`. Grouping is still right (`http_401` from the wrapper's `status`).
- **Fix**: Use `result.error.code || "-"` in the message.
- **Decision**: FIXED

### F6 — The smoke check parses the body inline next to the `jsonField` helper

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs:781
- **Detail**: `!Object.hasOwn(JSON.parse(body), "invitation_sent")` can't throw today, because the `account_created` check short-circuits first. `jsonField` (scripts/smoke.mjs:63-69) guards its parse, though, and a reorder would turn a failed assertion into a crash.
- **Fix**: Use `jsonField(body, "invitation_sent") === undefined`, or add a small `jsonHas(body, key)` helper.
- **Decision**: FIXED: `jsonField(body, "invitation_sent") === undefined`
