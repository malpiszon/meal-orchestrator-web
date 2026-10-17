<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Data isolation sweep (test-plan Phase 3)

- **Plan**: context/changes/testing-data-isolation/plan.md
- **Scope**: Phase 3 of 4
- **Reviewed phases**: 3
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria: 3.1 (local smoke on :4324), 3.3 (lint) and 3.4 (step names listed, and the smoke fails on a deliberately wrong confirm expectation) passed with evidence in this session. The break-check also passed: with `not_found` mapped to `plan_locked` in `src/lib/services/plans.ts`, the B choose and B confirm steps went red. 3.2 (CI smoke on the PR) is still pending until the PR is open.

## Findings

### F1 — Empty-result checks don't confirm the smoke user has data there

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1619-1645, :1789-1815
- **Detail**: `rpc/get_plan_recency` and `rpc/get_plan_ratings` for the smoke user's upcoming plan expect `[]` for the second user, and the choose step expects recency with none of the smoke user's ids or dates. Both checks mean something only if the owner has recency and a rating on that plan. That is shown much earlier, by HTML steps (:1087 "Last rated", :1408 same-week note), and isn't re-checked here. If an earlier step changes, these checks pass without testing anything.
- **Fix**: in the `SUPABASE_KEY` block, before the second user's calls, call both RPCs for the upcoming plan as the smoke user (`smokeToken`) and require a non-empty list.
- **Decision**: FIXED

### F2 — Database-API guards don't check every id the request uses

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1765-1770, :1780-1785
- **Detail**: The write and definer-RPC rows guard on `secondToken && laterOptionId`, but the `meal_ratings` and `rate_meal` rows use `ratedOptionId`, and the inserts use `smokeUserId`. If one of these is undefined, the request goes out with `eq.undefined` or without `user_id`. It can still answer 403/42501 (the grant check doesn't depend on the ids), so the step passes while its name says "with the smoke user's ids". The snapshot step would already have failed.
- **Fix**: guard each row on the ids it actually uses, e.g. a per-row `needs` list checked before the request.
- **Decision**: FIXED

### F3 — The INSERT 42501 check doesn't tell "revoked" apart from an RLS refusal

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1714-1771
- **Detail**: Postgres also returns 42501 for "new row violates row-level security policy", so a passing POST proves "refused by grant or RLS", while the comment says the writes are revoked. A PATCH or DELETE under RLS with the grant would answer 2xx and fail correctly.
- **Fix**: also pin the message prefix `permission denied for table <table>`.
- **Decision**: FIXED

### F4 — Two dashboard names never appear on any dashboard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1601
- **Detail**: `laterName` and `pastName` never show on the smoke user's own dashboard (it shows only this week and the nearest future week), so their absence from the second user's page proves nothing. The other five names carry the check.
- **Fix**: drop the two names from the list (or keep them with a comment saying why they are there).
- **Decision**: FIXED

### F5 — Snapshot step failure doesn't say which precondition broke

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1544-1567
- **Detail**: Four preconditions (upcoming plan, later week unsaved, unchosen option, rating present) share one body label, so a FAIL doesn't name the one that broke. Every later step depends on them.
- **Fix**: return `stepFailure("<which one>")` from the run function for each missing precondition.
- **Decision**: FIXED

### F6 — Third copy of the JSON row-parse block; meal_ratings special case inline

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs:1694-1712
- **Detail**: The parse / `Array.isArray` block repeats the one in `readOwnPlans` (:582) and `serviceRoleRead` (:646). `table !== "meal_ratings"` is hard-coded inside the map.
- **Fix**: have the table tuples carry a `requireOwnRows` flag, and reuse one row-parsing helper.
- **Decision**: FIXED

### F7 — The P0002 → 500 mapping depends on the PostgREST version

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:1774-1786
- **Detail**: Status 500 is what PostgREST v14.5 does (local and prod, per README). The body (`code P0002, message not_found`) is the real assertion, so a 500 from a crash still fails.
- **Fix**: name the version in the comment ("PostgREST v14.5 maps P0002 to 500").
- **Decision**: FIXED
