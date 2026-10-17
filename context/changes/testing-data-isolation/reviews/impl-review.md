<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Data isolation sweep (test-plan Phase 3)

- **Plan**: context/changes/testing-data-isolation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

Context: PR #190 is already merged and #121 is closed. Phases 1–3 each had their own review, and all of those findings are fixed. Gates run for this review, before the fixes below:

- `npx supabase test db`: PASS. 12 files, 314 tests, full log saved to the scratchpad.
- `npm run lint`: PASS, with 0 errors and 2 `no-console` warnings that already existed.
- prettier: PASS.
- CI on #190: ci, smoke, e2e and changes all pass.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Realtime and Storage exposure is unpinned

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/exposed_surface.test.sql:1-13
- **Detail**: `supabase/config.toml:81,109` enables `[realtime]` and `[storage]`, and both reach the public keys outside PostgREST. Research (research.md) found an empty `supabase_realtime` publication and no buckets, but no test pins either fact. Any of the following would pass every test:
  - `alter publication supabase_realtime add table public.weekly_plans`
  - a public `storage.buckets` row
  - a `storage.objects` / `realtime.messages` policy for anon or authenticated

  The test-plan §6.5 note relies on a one-time manual check on prod.

- **Fix A ⭐ Recommended**: Add assertions to `exposed_surface.test.sql`:
  - `is_empty` on `pg_publication_tables` and on `storage.buckets`
  - a `results_eq` pinning `pg_policies` in schemas `storage` and `realtime` to the current (default) set

  Then add one §6.3 line ("a table added to realtime or a new bucket updates the allowlist and gets a sweep case").
  - Strength: the allowlist really becomes "everything the public keys can reach", matching what risk #3 names. It costs a few catalog reads and no migration.
  - Tradeoff: a merged change needs a follow-up PR, and the Supabase CLI could add a default storage or realtime policy on upgrade, which would trip the policy pin.
  - Confidence: MED. The catalog tables exist locally (storage enabled), but the default policy set in the storage and realtime schemas hasn't been listed.
  - Blind spot: it is unconfirmed that `storage.buckets` is readable by `postgres` in the pgTAP session.

- **Fix B**: Narrow the wording instead. The header and the docs/testing.md bullet say "through PostgREST", and §6.5 records Realtime and Storage as an untested gap.
  - Strength: a docs-only change, so the claim becomes accurate.
  - Tradeoff: the gap stays open until a feature uses realtime or storage.
  - Confidence: HIGH. It is a wording change.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — exposed_surface.test.sql pins pg_publication_tables, storage.buckets and storage/realtime policies empty (plan 9 → 12); §6.3 and docs/testing.md say so. Red probe (published table, bucket, storage policy, rolled back) fails all three with the object named.

### F2 — Review fix F2 (MAINTAIN comment) missing from the sweep header

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/tests/second_user_isolation.test.sql:10-13
- **Detail**: follow-ups/review-fixes.md queued for Phase 2 a why-no-case comment for the MAINTAIN grant, which can't be issued through PostgREST, the same as REFERENCES and TRIGGER. The header explains keepalive, adjusted_score and the graphql stub, but not MAINTAIN, REFERENCES or TRIGGER. The reason exists only in exposed_surface.test.sql:61-65.
- **Fix**: Add one sentence to the "Allowlist rows without a B case" comment: MAINTAIN, REFERENCES and TRIGGER can't be used through PostgREST, so they need no case.
- **Decision**: FIXED — the header comment now says MAINTAIN, REFERENCES and TRIGGER need no case (they can't be issued through PostgREST), and that Realtime and Storage are pinned empty in the allowlist.

### F3 — pgTAP direct-write checks accept any 42501

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/second_user_isolation.test.sql:163-212
- **Detail**: Nine `throws_ok(…, '42501', null, …)` calls leave the message open. If the INSERT grant came back, "new row violates row-level security policy" (also 42501) would pass too. The smoke pins `permission denied for table <t>` (the Phase 3 F3 fix). exposed_surface test 4 still catches a returned grant, so the risk is low.
- **Fix**: Pass `'permission denied for table <table>'` as the errmsg argument for each table.
- **Decision**: FIXED — the nine direct-write throws_ok checks now pin 'permission denied for table <t>', so an RLS refusal after a returned grant would fail them.

### F4 — Smoke service-role RPC refusals match the code only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs (the `rpc/${fn} is refused` rows, `pgError("42501")`)
- **Detail**: Unlike the table-write rows, these don't pin `permission denied for function ${fn}`. A 42501 raised inside the function body would also pass.
- **Fix**: Pin the message `permission denied for function ${fn}`, as the table rows do.
- **Decision**: FIXED — the service-role refusal rows pin `permission denied for function ${fn}`; smoke on :4324 passes (all three 403 with that message).

### F5 — "Local and CI only" second user is a convention, not enforced

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:343-346; context/foundation/test-plan.md:161
- **Detail**: The comment and §6.5 say the second user exists only on the local and CI stacks. The smoke creates it, with the hard-coded password `Smoke-Second-Passw0rd!`, on whatever `SUPABASE_URL` and service-role key it is given, and never deletes it. The smoke user and the round-trip user already did the same before this change, and CI runs the smoke only on the local stack.
- **Fix A ⭐ Recommended**: Reword both texts to "by convention: the smoke runs only against local and CI stacks", and leave a loopback guard to a separate change.
  - Strength: an accurate claim for one line of docs, and it stays within this change's tests-only scope.
  - Tradeoff: no protection against a mistaken prod run.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Fix B**: Make the smoke refuse a non-loopback `SUPABASE_URL` unless an explicit opt-in env var is set.
  - Strength: it enforces the claim for all three smoke users.
  - Tradeoff: it changes smoke behaviour and touches every smoke user, which goes beyond S-03.
  - Confidence: MED. CI's local URL is loopback, but how the hostnames are written hasn't been checked.
  - Blind spot: whether anyone runs the smoke against a remote preview stack.
- **Decision**: FIXED via Fix A — the smoke comment and test-plan §6.5 now say the second user is created on whatever stack the smoke targets and never deleted, local-and-CI-only by convention. A loopback guard (Fix B) is left for a separate change.

### F6 — Post-merge closeout incomplete (#121 boxes, roadmap status)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: GitHub #121 body; context/foundation/roadmap.md:59
- **Detail**: #190 merged and #121 is closed, and sub-issues #185–#188 are all closed. Even so, #121 still has three unticked boxes: "All phase sub-issues closed", "Implemented; PR merged" and "`roadmap.md` status set to `done`". roadmap.md (also on master) still shows S-03 as `in-progress`.
- **Fix**: Tick the three #121 boxes, then run `/10x-roadmap` to set S-03 to `done`, through a PR to master.
- **Decision**: FIXED — #121 boxes "All phase sub-issues closed" and "Implemented; PR merged" ticked; roadmap.md S-03 set to `done` (At a glance, body, Backlog Handoff) on branch testing-data-isolation-review-fixes. The "roadmap.md status set to done" box is ticked once that branch merges.

## Triage summary

| Outcome | Findings                               |
| ------- | -------------------------------------- |
| Fixed   | F1 (Fix A), F2, F3, F4, F5 (Fix A), F6 |

After the fixes: `npx supabase test db` PASS (12 files, 317 tests; F1 added 3); `npm run smoke` against a preview on :4324 PASS; ESLint and Prettier pass on the changed files.
