<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Data isolation sweep (test-plan Phase 3)

- **Plan**: context/changes/testing-data-isolation/plan.md
- **Scope**: Phase 2 of 4
- **Reviewed phases**: 2
- **Date**: 2026-10-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Every Phase 2 contract item is in `supabase/tests/second_user_isolation.test.sql`. The extra fixtures (A's week starting T+14, B's started week and rating) make the "returns nothing" and "B's own rows visible" checks non-vacuous, and the subagent reported them. Everything runs inside begin/rollback. The UUID prefix and emails are unique across this checkout, the main checkout, S-02's and the replay seed. The master merge (d58b677) added no migrations, so the allowlist and the sweep are still complete. Automated criteria, re-run after the merge: `npx supabase test db` passes (12 files, 311 tests). The `using (true)` probe on `plan_meal_options` fails exactly test 5 (have 7939, want 0). `npm run lint` shows 0 errors. Manual check 2.4 was run with the 43 TAP lines mapped to the allowlist.

## Findings

### F1 — Two definer-RPC targets aren't asserted to be changeable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/second_user_isolation.test.sql:201-213
- **Detail**: The comment says each target "would be accepted for A … so a missing ownership check would write". For `choose_plan_option(a_STEW_14)` that holds only while STEW is not the chosen option of A's week starting T+14. For `confirm_plan(a_plan_14)` it holds only while that plan's `saved_at` is null. Both are true today: rating SOUP 5 re-picks SOUP, and T+14 is never confirmed. Nothing asserts them, though. If the default picks changed so that STEW came out chosen, a missing ownership check in `choose_plan_option` would be a silent no-op, and the snapshot `set_eq` (:315) would still pass. (The rating targets are safe: 5→4 or a delete always differs from the snapshot.)
- **Fix**: Before the B section, add two fixture assertions as postgres: `a_STEW_14` has `is_chosen = false`, and `a_plan_14` has `saved_at is null` (plan 43 → 45).
- **Decision**: FIXED

### F2 — anon's 42501 checks that call `pg_temp.ref` have no positive anchor

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/second_user_isolation.test.sql:261-290
- **Detail**: These `throws_ok(..., '42501')` checks would also pass if anon couldn't read the `refs` temp table or the `pg_temp` helper, because that raises 42501 too. The drift agent's probe confirmed that anon reads `refs` today, and Postgres checks EXECUTE on the outer function first, so the checks are real now. Still, no assertion in the file shows it. B's 42501 checks don't have this gap: B's P0002 and `is_empty` checks use the same helper.
- **Fix**: As anon, before :261, add `select isnt(pg_temp.ref('a_plan_14'), null, 'anon can read the refs fixture')`.
- **Decision**: FIXED

### F3 — The user_id invariants scan every row of the shared database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/second_user_isolation.test.sql:326-339
- **Detail**: The two closing invariants cover all committed rows (about 7.9k locally from dev and smoke runs, plus the replay seed in CI), not just A's and B's. This is deliberate, because the invariant has to hold for any data. A local failure would mean a real inconsistent row, such as a hand edit in Studio, not flakiness. The comment doesn't say so.
- **Fix**: Extend the comment at :326 to say the scan covers every row on purpose, and that a failure means someone's committed data is inconsistent.
- **Decision**: FIXED
