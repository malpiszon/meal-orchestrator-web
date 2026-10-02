<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: MO Weekly Delivery (S-01)

- **Plan**: context/changes/mo-weekly-delivery/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated criteria were re-run on 2026-10-02: `npm test` passed (36/36), as did lint, `astro check` (0 errors), `npm run build` and `npx supabase db reset`. `ingest_weekly_plan(text,text,date,date,text,jsonb,jsonb)` can be executed by `service_role` only, not by `anon` or `authenticated`. Deploy run 37030553262 is green, and the post-deploy check got 401. Every planned change in Phases 1–4 is in place and does what the plan intended. Two additions go beyond the plan, both harmless: the dev-only `allowedHosts` setting and the ESLint script globals.

## Findings

### F1 — Concurrent first delivery for a new email returns 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:113-116
- **Detail**: When two requests for an email mo-web doesn't know yet overlap (for example, MO retrying after a timeout), both get `unknown_user` and both call `auth.admin.createUser`. GoTrue checks whether the email exists and then inserts, so the losing call hits the `users_email_partial_key` unique index. GoTrue reports that as a 500 `unexpected_failure`, not as `email_exists`. The route only tolerates `email_exists` and `user_already_exists`, so the losing request returns `storage_failed`. The local Supabase logs from MO's run at 2026-10-02 14:12:41 UTC confirm this sequence: three `unknown_user` errors within 13 ms, two duplicate-key errors from `supabase_auth_admin`, and two 500s from GoTrue. `ingest_weekly_plan` itself is safe under concurrency, because `ON CONFLICT` on `weekly_plans` serializes the two writers. This contradicts the contract's claim (`mo-delivery-contract.md:128`) that repeating a request is always safe. The effect is limited to a user's very first delivery, and MO's retries recover from it.
- **Fix**: Treat any `createUser` error as "the user may exist now". Log it if it isn't one of the email-exists codes, then retry the ingest anyway. If the user still doesn't exist, the existing 500 path takes over.
  - Strength: The decision rests on what the database says, not on GoTrue's error code. Matching `unexpected_failure` would be fragile, because that is GoTrue's catch-all code.
  - Tradeoff: A genuine `createUser` failure costs one extra RPC before the 500.
  - Confidence: HIGH — the cause is confirmed in the container logs, and the change touches about 3 lines.
  - Blind spot: There's no automated test for concurrent deliveries. Simulating the race in smoke would take parallel POSTs.
- **Decision**: FIXED — createUser errors no longer return early; the ingest retry decides. Verified: 3 rounds × 5 parallel first deliveries, 12 GoTrue duplicate-key races, all 200, one account_created:true per round.

### F2 — README is stale and incomplete about the delivery endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md:119, and the Responses bullet under "MO delivery endpoint"
- **Detail**: Line 119 still says `npx supabase start` applies only the `keepalive` migration, but the weekly-plans migration now exists too. The Responses bullet lists 200, 503 and 500 (plus 401 and 400 above it). It leaves out the 413 `payload_too_large` response added by the Phase 2 fix, the 400 for a payload Postgres can't store (`\u0000`), and the 403 the framework returns for a non-JSON `Content-Type`. The contract document lists all of them.
- **Fix**: Update line 119 to name both migrations. Add 413, plus a pointer to the contract's response table, to the Responses bullet.
- **Decision**: FIXED — Responses bullet adds 413 and points to the contract's table; the migrations note names both migrations.

### F3 — Roadmap S-01 still `in-progress` after merge

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:46, :126
- **Detail**: PR #30 has merged, and #4 and #24–#27 are closed. CLAUDE.md says to set the roadmap item to `done` after merge, using `/10x-roadmap`.
- **Fix**: Run `/10x-roadmap` (or `/10x-archive`, which flips it to `done`) before pushing `master`.
- **Decision**: ACCEPTED — deferred to `/10x-archive`, which flips S-01 to `done`; to run right after this review.

### F4 — Email lookup in `ingest_weekly_plan` can't use an index

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261001120000_weekly_plans.sql:77
- **Detail**: `lower(u.email) = lower(p_email)` can't use GoTrue's email index, so every delivery scans `auth.users`. This is negligible at MVP size.
- **Fix**: In a new migration (this one is already in production), compare `u.email = lower(p_email)`. GoTrue stores emails lowercased.
- **Decision**: FIXED — new migration `20261002170000_ingest_weekly_plan_email_index.sql` (`u.email = lower(p_email) and u.is_sso_user = false`; EXPLAIN: seq scan → index scan on users_email_partial_key; GoTrue lowercasing confirmed locally). Needs `npx supabase db push` to production before the follow-up PR merges.

### F5 — Option rows rebuilt on the provisioning retry

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:92-102
- **Detail**: `ingest()` rebuilds `toOptionRows(delivery)` and the RPC arguments on each call, so the provisioning path does that work twice against the Worker's 10 ms CPU budget.
- **Fix**: Build the RPC arguments once and reuse them in both calls.
- **Decision**: FIXED — RPC args built once (`ingestArgs`) and reused by both calls.

### F6 — No CI regression guard for the function grants or the `sb_secret_…` key

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs
- **Detail**: The Phase 1 criterion "anon cannot execute `ingest_weekly_plan`" was proved ad hoc, so nothing in CI keeps it true. CI also runs with the CLI's JWT-format `SERVICE_ROLE_KEY`, while production uses an `sb_secret_…` key. The code doesn't assume a JWT, but no automated check covers that combination.
- **Fix**: Add a smoke step that calls `POST /rest/v1/rpc/ingest_weekly_plan` with the anon key and expects a 401/403/404 refusal.
- **Decision**: FIXED — smoke step "anon cannot execute ingest_weekly_plan" (401 + code 42501, skipped without SUPABASE_URL/SUPABASE_KEY); CI passes the local URL and anon key. Break-check: granting execute to anon turned the step red. The sb_secret_… key gap stays informational.
