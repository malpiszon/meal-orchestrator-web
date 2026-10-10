<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Migration and Date-Rule Safety

- **Plan**: context/changes/testing-migration-date-rules/plan.md
- **Mode**: Deep
- **Date**: 2026-10-10
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓ (`src/test/` is new and duplicates nothing), 4/4 symbols ✓, brief↔plan ✓, Progress↔Phase 18/18 ✓.

The verification agent confirmed:

- Replacing an inlined function invalidates the cached plans that depend on it.
- No existing pgTAP assertion breaks when the seed adds other users' rows.
- The guard regex has no false positives on today's 10 functions.
- The CLI has `db reset --version`, `migration up --local` and `test db <path>`, and `status -o env` prints `DB_URL`.
- psql is on ubuntu-latest.

## Findings

### F1 — Replay script needs psql, which isn't on PATH locally

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Replay script
- **Detail**: The seed is loaded with `psql "$DB_URL"`. `which psql` is empty in WSL, so 3.1 would fail locally.
- **Fix**: Fall back to `docker exec -i supabase_db_<project_id> psql`, and document the requirement.
- **Decision**: FIXED

### F2 — Guard regex as written misses real forms

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Helper and bypass-guard tests
- **Detail**: In a regex, a literal `now()::date` holds an empty group. The plan doesn't say the match is case-insensitive, and it misses `timezone(…)`, `current_timestamp::date` and `localtime`.
- **Fix**: Specify an explicit `~*` pattern and keep plain `now()` allowed.
- **Decision**: FIXED

### F3 — Private-schema check (1.6) tests nothing; privileges unasserted

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Manual 1.6
- **Detail**: PostgREST resolves RPCs only in `public`, so the HTTP check 404s whatever the grants are. Postgres grants EXECUTE to PUBLIC by default, and nothing asserts the revoke.
- **Fix**: Add `schema_privs_are` and `function_privs_are` assertions, and make 1.4 an automated row.
- **Decision**: FIXED

### F4 — CLI behaviours the replay depends on are unverified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Replay script, CI step
- **Detail**: Unconfirmed: whether `test db` mounts a path outside `supabase/tests`, and whether `db reset` respects the `-x` exclusions. `pg_prove -r` is recursive, so the checks must stay out of `supabase/tests/`.
- **Fix**: Open Phase 3 with a spike that has a fallback, and add the location rule.
- **Decision**: FIXED

### F5 — README Scripts table not updated for `test:replay`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Docs and test plan
- **Detail**: README lists every script, but the plan updated only docs/testing.md.
- **Fix**: Add a README Scripts row.
- **Decision**: FIXED

### F6 — Pinning caveat names the wrong constraint

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details
- **Detail**: Plans are invalidated on replace. The real constraint is ownership: `postgres` isn't a superuser, so the pin must run before any role switch.
- **Fix**: Reword the caveat.
- **Decision**: FIXED

### F7 — Check commands that write, and mutation steps under Automated

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress 1.4, 3.4
- **Detail**: `npm run format` writes files instead of checking them, and the rename mutation step sat under Automated.
- **Fix**: Use `npx prettier --check .` and move the mutation step to Manual (now 1.6).
- **Decision**: FIXED
