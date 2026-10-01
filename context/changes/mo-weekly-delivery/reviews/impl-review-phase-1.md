<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: MO Weekly Delivery (S-01)

- **Plan**: context/changes/mo-weekly-delivery/plan.md
- **Scope**: Phase 1 of 4
- **Reviewed phases**: 1
- **Date**: 2026-10-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Notes:

- **Plan contract:** `supabase/migrations/20261001120000_weekly_plans.sql` matches it column for column:
  - Both tables, the `(user_id, week_start)` and `(plan_id, meal_date, meal_type, variant_index)` uniques, the S-02 index, and the score check.
  - RLS is enabled, with one `select` policy per table, for `authenticated` only, using `(select auth.uid())`.
  - Writes are revoked from `anon` and `authenticated`.
  - The function is `security definer` with `search_path = ''`, raises `P0002`/`unknown_user`, upserts, replaces the options via `jsonb_to_recordset`, and is executable by `service_role` only.
  - It follows the same pattern as `20260925192719_keepalive_function.sql`.
- **Evidence gathered 2026-10-01 on the local stack (no data was changed):**
  - Over REST, anon gets `42501 permission denied` for the RPC and for inserts, and an empty list for selects.
  - Table grants: `anon` and `authenticated` have only REFERENCES, SELECT and TRIGGER (Supabase defaults). The only policies are the two `select` policies for `authenticated`.
  - Function: `prosecdef = true`, `search_path=""`, and only `service_role` can execute it.
  - RLS isolation, in a transaction rolled back afterwards: as `newbie@example.com` (authenticated), 1 of the 3 plans and its 30 options are visible, all owned by that user.
  - `supabase db lint --schema public` finds no errors.
- **Concurrency:** two deliveries for the same (user, week) are safe. The upsert locks the `weekly_plans` row until the transaction commits, so the delete-then-insert of options happens one delivery at a time.
- **Not re-run:** `npx supabase db reset`. It would wipe the local test data from the Phase 2 manual checks. It passed at commit 8643573 (Progress 1.1).

## Findings

### F1 — The database doesn't enforce meal type or week-range rules

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261001120000_weekly_plans.sql:6-33
- **Detail**:
  - `meal_type` is free text, and the database has no checks for `week_end >= week_start` or `variant_index >= 0`. Only the endpoint's zod schema enforces these rules today.
  - Every write goes through `ingest_weekly_plan`, which only `service_role` can execute. So the risk is a future write path (an S-03 swap, or a manual fix in SQL) bypassing the schema. Phase 3's slot ordering would then silently drop an unknown `meal_type`.
  - The migration hasn't been pushed to production yet, so editing it in place is still cheap.
- **Fix A**: Add `check` constraints in this migration: `meal_type in (…6 slots…)`, `week_end between week_start and week_start + 6`, `variant_index >= 0`.
  - Strength: The database itself guarantees what Phase 3 and S-02 rely on, whatever the write path.
  - Tradeoff: The meal-type list then lives in two places (SQL and `MEAL_TYPES` in src/types.ts), and adding a slot needs a migration.
  - Confidence: HIGH — standard constraints, and the local data already satisfies them.
  - Blind spot: Requires `supabase db reset` locally, which wipes the test data.
- **Fix B ⭐ Recommended**: Skip. Keep validation in the endpoint, which is the single write path.
  - Strength: One source of truth for the slot list; no migration churn.
  - Tradeoff: A future write path has to remember to validate.
  - Confidence: MED — holds as long as all writes stay behind `security definer` functions, which is this design's rule.
  - Blind spot: S-03 swap writes haven't been designed yet.
- **Decision**: SKIPPED via Fix B — validation stays in the endpoint (the only write path); S-03 must validate any new write path
