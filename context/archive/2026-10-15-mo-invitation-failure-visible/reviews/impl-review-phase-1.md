<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: MO invitation failure visible

- **Plan**: context/changes/mo-invitation-failure-visible/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: commit 744c490 adds `src/lib/mo-delivery-faults.ts` and `src/lib/mo-delivery-faults.test.ts` as planned; `isAuthRejection` matches the contract (401/403, PGRST301/PGRST302 true; everything else false). The tests cover every case the plan lists (the "plain storage error" case is pinned as `XX000`/"storage"). Scoped vitest run: 14/14 passed; eslint on both files is clean. The break-check during implementation (removing 403 and PGRST302) turned 2 tests red. The `roadmap.md` diff in the commit is the S-10 status flip plus a Prettier re-pad of the At-a-glance table (the pre-commit hook widened the Status column for `in-progress`), so it's benign. Manual 1.3 was checked against the live local stack (probe results below).

## Findings

### F1 — PostgREST errors carry no status, so a direct call misses rejected keys

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/mo-delivery-faults.ts:19 (consumer: src/pages/api/mo/deliveries.ts, Phase 2)
- **Detail**: `PostgrestError` stores only `code`, `message`, `details` and `hint`. The HTTP status sits next to it on the result (`node_modules/@supabase/postgrest-js/dist/index.mjs:26-55, 530-536`). On the local stack, using the anon key as the service-role key gave the RPC `401 {code: "42501", "permission denied for function ingest_weekly_plan"}`, so `isAuthRejection(result.error)` returns false and the route would still answer a retryable 500. Hosted Supabase probably behaves the same way: its gateway likely answers a bad key with 401 "Invalid API key" and no `code` (not verified here). PostgREST's `PGRST303` (JWT claims rejected, 401) is likewise caught only through the status. Auth errors (`inviteUserByEmail`, `createUser`) do carry `status` (403 `bad_jwt` / `not_admin` observed), so they need no extra handling.
- **Fix A ⭐ Recommended**: In Phase 2, call `isAuthRejection({ ...result.error, status: result.status })` for the RPC; keep the Phase 1 signature.
  - Strength: The Phase 1 contract already accepts `status`; no change to the committed module or its tests.
  - Tradeoff: The call site has to remember to pass the status; a later caller could repeat the mistake.
  - Confidence: HIGH — the local probes show 401 on `result.status` for all three wrong-key shapes.
  - Blind spot: The hosted gateway's exact body hasn't been observed.
- **Fix B**: Change the signature to `isAuthRejection(error, httpStatus?)` and add a test where `42501` with HTTP status 401 counts as an auth rejection.
  - Strength: The status input is explicit in the API, so the PostgREST case can't be silently forgotten.
  - Tradeoff: Reopens a committed phase and diverges from the plan's contract.
  - Confidence: MED — cleaner API, but only one call site needs it.
  - Blind spot: None significant.
- **Decision**: Fix A — queued for Phase 2 (follow-ups/review-fixes.md); Phase 1 module unchanged
