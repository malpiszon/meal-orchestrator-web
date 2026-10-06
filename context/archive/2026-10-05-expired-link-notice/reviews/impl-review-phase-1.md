<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Expired Link Notice on Open

- **Plan**: context/changes/expired-link-notice/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- Diff (`d7fee09..39e455d`): the planned migration and pgTAP test, plus `plan.md` Progress. Nothing unplanned, nothing missing.
- Migration body is the plan's predicate verbatim; header names GoTrue v2.197.0, the research doc and the Supabase-managed-table risk. Expiry boundary `now() <= sent_at + lifetime` matches GoTrue's `isOtpExpired` (expired iff now is after sent_at + exp).
- Live attributes: owner `postgres`, `security definer`, `stable`, `search_path=""`. Grants: anon denied (pgTAP and the 1.3 probe's `42501`), service_role allowed.
- Lookup uses `one_time_tokens_token_hash_hash_idx` and the `auth.users` primary key.
- `create or replace function` + revoke/grant follows `ingest_weekly_plan`; the test follows `get_plan_recency.test.sql` (transaction, `plan(n)`, `finish()`, `rollback`).
- Every plan case is covered (14 assertions; the 59-min case covers both types). The deliberate break of the recovery expiry check turned 2 tests red.
- Re-run during review: `npx supabase db reset` PASS, `npx supabase test db` PASS (49 tests).
- Manual 1.3: probe run in session against real GoTrue (true → verify 200 → false; anon 42501), confirmed by the user.

## Findings

None.
