<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Delivery and Re-send Integrity (S-02)

- **Plan**: context/changes/testing-delivery-resend-integrity/plan.md
- **Scope**: Phase 2 of 4
- **Reviewed phases**: 2
- **Date**: 2026-10-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Evidence: the moved handler is byte-identical to the old route body except for imports, `prerender`, the signature and docblock, and `const { supabase, token: MO_INGEST_TOKEN } = deps;`; the check order, constant-time token compare and log contents (no email, body or token) are unchanged. All 16 planned test cases are present and assert what the plan says, against the contract's Responses table. Re-run at review: `npm test` 392/392, `npx astro check` 0/0, `npm run lint` 0 errors (2 warnings from before, in untouched `report-handled-error.ts`), `npm run smoke` on :4322 passed. Manual 2.5 was checked against that diff.

## Findings

### F1 — Console spies are never restored

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/mo-deliveries.test.ts:51-55
- **Detail**: `beforeEach` spies on `console.error` and `console.warn` but never restores them. There is no `afterEach(() => vi.restoreAllMocks())`, and `vitest.config.ts` sets no `restoreMocks`. Every sibling restores its spies (`auth-links.test.ts:45-47`, `auth-session.test.ts:33-35`, `plans.test.ts:109-111`). Call history builds up across tests, so a later `toHaveBeenCalledTimes` on console would count calls from every earlier test.
- **Fix**: Add `afterEach(() => vi.restoreAllMocks())`, matching the siblings.
- **Decision**: FIXED — afterEach(() => vi.restoreAllMocks())

### F2 — First smoke run had an unexplained 500 on a new-email delivery

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: N/A (scripts/smoke.mjs step "delivery for a new email creates the account")
- **Detail**: The first smoke run on a freshly started preview got 500 for this step. The gateway log shows that request's invite, metadata update and retried ingest all answered 200. A direct delivery to a fresh email then answered 200 with `account_created: true`, and the next 2 full smoke runs passed. The preview's logs were lost, so the cause is unknown; slow cold start of workerd on `/mnt/d` is a guess. The provisioning branch moved over byte-identical, so a regression from this phase is unlikely, though not proven.
- **Fix**: Treat CI's smoke job on the PR as the check. If it recurs locally or in CI, rerun with preview output captured to a log, and use the `logStorageError` lines to find the failing step.
  - Strength: Costs nothing now; CI starts a clean preview every run, so any recurrence would show up there.
  - Tradeoff: A real intermittent provisioning fault would stay hidden until it recurs.
  - Confidence: MED — 3 passing runs and the identical code argue against a regression; one failure with no log is not explained.
  - Blind spot: The Worker's console output for the failing request.
- **Decision**: ACCEPTED — rely on CI's smoke job; on recurrence rerun with the preview output logged

### F3 — "Never log the email or body" is not pinned

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/mo-deliveries.test.ts:142-188
- **Detail**: Console output is silenced but never checked. A change that started logging `delivery.user.email` in the 409 warn or a storage error would stay green, even though "never log the request body or the email" (`mo-deliveries.ts:49`) is a privacy rule.
- **Fix**: In the 409 and 500 tests, assert that no `console.warn`/`console.error` call argument contains `sample.user.email`.
- **Decision**: FIXED — 409 test asserts no console line contains the email; 500 tests assert the reported error's message doesn't (break-checked)

### F4 — `p_options` is not asserted

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/mo-deliveries.test.ts:200-216
- **Detail**: The RPC-argument test checks `p_raw` and the scalar arguments, not `p_options`; dropping it would stay green. Phase 3's smoke round trip checks every option end to end, so the gap is temporary. A unit check should count options from the fixture, not compare with `toOptionRows` (plan: expectations come from the contract).
- **Fix**: Assert that `p_options` has one row per variant in the sample (a count taken from the fixture).
- **Decision**: FIXED — asserts one p_options row per sample variant, counted from the fixture (break-checked)

### F5 — The lying-header test doesn't confirm the header survived

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/mo-deliveries.test.ts:94-105
- **Detail**: The test relies on `Request` keeping `Content-Length: 100`, so that the byte-length branch, not the header branch, gives the 413. The first 413 test asserts that its header survived; this one doesn't. It is sound on Node 22 / undici today.
- **Fix**: Add `expect(request.headers.get("Content-Length")).toBe("100")`.
- **Decision**: FIXED — explicit Content-Length: 100 assertion

### F6 — Unplanned eslint allowlist edit; the old route entry is now redundant

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:85-102
- **Detail**: The plan doesn't mention adding `src/lib/services/mo-deliveries.ts` to the Workers Logs `no-console` allowlist, but it is needed: the moved code's `console` calls would otherwise add 2 lint warnings. The comment above the list still describes it. The `src/pages/api/mo/**/*.ts` entry now covers a route with no console calls. It is harmless, and S-10 may add logging to that route.
- **Fix**: Keep both entries; no change.
- **Decision**: ACCEPTED — keep both allowlist entries
