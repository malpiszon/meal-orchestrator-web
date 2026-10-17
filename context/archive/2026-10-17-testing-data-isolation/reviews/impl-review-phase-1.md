<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Data isolation sweep (test-plan Phase 3)

- **Plan**: context/changes/testing-data-isolation/plan.md
- **Scope**: Phase 1 of 4
- **Reviewed phases**: 1
- **Date**: 2026-10-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Notes:

- **Plan adherence:** the `graphql_public.graphql` stub row is a deliberate adaptation the user approved.
- **Success criteria:**
  - The full pgTAP suite passes (10 files, 240 tests).
  - The plan's two break cases (an INSERT grant, a new function) fail with a diff that names the object.
  - Manual check 1.4 has its evidence on #121 (issuecomment-6233302026).
  - The migration replay wasn't run locally because it wipes the shared database. CI runs it.

## Findings

### F1 — Table-grant check misses PUBLIC and inherited grants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/exposed_surface.test.sql:68-79
- **Detail**: Test 4 reads `information_schema.role_table_grants` filtered to `grantee in ('anon', 'authenticated')`, so it sees only direct grants. Two probes, each in a rolled-back transaction, passed all 9 tests even though the API roles really gained the privilege:
  - `grant insert on public.weekly_plans to public`
  - granting DELETE on `meal_ratings` to a new role that `authenticated` is a member of

  This contradicts the plan's goal that "a grant that leaks fails a test". The function check doesn't have this gap, because it already uses `has_function_privilege`.

- **Fix**: Build the actual set with `has_table_privilege(role, c.oid, priv)` over every table privilege type, for each exposed relation and each of anon and authenticated. The expected set stays the same. This matches how the function check works.
- **Decision**: FIXED — test 4 now uses has_table_privilege over all privilege types. That surfaced a MAINTAIN grant held by both roles on all three tables (a Supabase default the migrations never revoke, and unreachable through PostgREST). The user chose to pin it as allowed, with no migration, and it is noted on #121 as a candidate revoke. The PUBLIC and inherited-role probes now go red.

### F2 — graphql stub row needs a Phase 2 counterpart

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/tests/exposed_surface.test.sql:111-114
- **Detail**: The allowlist has one row the plan didn't list. Phase 2's manual check 2.4 asks that every allowlist row has a case, or a comment saying why none is needed. The plan names only `keepalive` and `adjusted_score` for the comment route.
- **Fix**: In Phase 2, add a why-no-case comment for `graphql_public.graphql` (the stub returns only an error and reads no data) next to the `keepalive` and `adjusted_score` comments.
- **Decision**: FIXED — queued for Phase 2 in follow-ups/review-fixes.md (the graphql stub and MAINTAIN get why-no-case comments).

### F3 — The exposed-schema list is fixed in the test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/exposed_surface.test.sql:1-9
- **Detail**: The schema list comes from `supabase/config.toml` `[api] schemas`, but the test lists `public` and `graphql_public` itself. Exposing another schema through config.toml (or the hosted dashboard) wouldn't fail anything. The header names the source but doesn't say to keep the two in sync.
- **Fix**: Add a header line saying that a schema added to `[api] schemas` must be added to every `nspname in (...)` list here. Phase 4's §6.3 should say the same.
- **Decision**: FIXED — added a header line to exposed_surface.test.sql; the §6.3 note is queued for Phase 4 in follow-ups/review-fixes.md.
