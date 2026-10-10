<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Migration and Date-Rule Safety

- **Plan**: context/changes/testing-migration-date-rules/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence:

- All three planned files match the plan. Each of the four redefined functions differs from its latest definition only on the "today" line, and grants are restated exactly.
- The benign extras are:
  - SELECT for `authenticated` on the three read tables;
  - a primary-key check on `meal_ratings.option_id`;
  - an overload check;
  - the guard's exclusion of extension-owned functions.
- Re-run during review:
  - `npx supabase test db`: 8 files, 207 tests pass;
  - `npm run lint`: 0 errors;
  - `npm test`: 172 tests pass.
- Manual checks:
  - 1.5 is backed by a scripted body diff;
  - 1.6 is backed by the deliberate-break check, where renaming a `rate_meal` argument made `rpc_contract` #16 fail.

## Findings

### F1 — Bypass guard misses common explicit date derivations

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/warsaw_today.test.sql:48-59
- **Detail**: The planned regex catches `at time zone`, `timezone(`, `current_date`, `localtime` and `now()::date`, including spacing variants. Tested locally, it does not catch these explicit forms:
  - `cast(now() as date)` and `date(now())`;
  - `now()::timestamp::date`;
  - `statement_timestamp()`, `clock_timestamp()` and `transaction_timestamp()` cast to a date;
  - `'today'::date`.

  It also cannot catch implicit assignment casts (`v_today date := now();`), because Postgres converts timestamptz to date on assignment. A regex cannot see those. Phase 2's pinned-date boundary tests are the backstop for the rules they cover.
- **Fix**: Widen the regex to cover the explicit forms above, and change the test description and comment to say what it really guarantees: "no explicit date derivation". Implicit casts are left to the pinned-today boundary tests.
  - Strength: It closes the cheap, likely bypasses, and the claim becomes honest.
  - Tradeoff: More false positives, for example a comment mentioning `date(`. That is the safe direction.
  - Confidence: HIGH. Today only `warsaw_date` matches among the 12 functions, so a wider regex shouldn't break the suite. Re-run it to confirm.
  - Blind spot: Defaults, constraints, policies and views are not scanned. None of them derive a date today.
- **Decision**: FIXED — regex widened to the explicit forms, description now "derives a date explicitly", implicit-cast limit stated in the comment; a planted `cast(now() as date)` function trips it

### F2 — keepalive return type is pinned more strictly than the consumer needs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/tests/rpc_contract.test.sql:42
- **Detail**: `keepalive` returns `timestamptz`, but the Worker ignores the result, and the comment at L40 says "any result". A change to `void` would fail the contract test while the old Worker kept working.
- **Fix**: Keep the pin and change the comment, to say the return type is pinned from the schema and the TS does not read it. Alternatively, drop the return-type assertion.
- **Decision**: FIXED — comment now says the TS ignores the result and the return type is pinned from the schema

### F3 — `create schema private` fails if prod already has that schema

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010120000_warsaw_today_helper.sql:23
- **Detail**: There is no `if not exists`, and no other migration creates a schema. Failing hard is safer than silently adopting a schema with an unknown owner and ACL, and the push fails atomically.
- **Fix**: Keep the statement. Before the 3.7 production push, run `select nspname, nspowner::regrole, nspacl from pg_namespace where nspname = 'private'` against prod.
- **Decision**: FIXED — prod pre-push `pg_namespace` check recorded in change.md Notes for Progress 3.7
