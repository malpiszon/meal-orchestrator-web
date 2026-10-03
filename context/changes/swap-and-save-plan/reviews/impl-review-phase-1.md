<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Swap and save the upcoming plan

- **Plan**: context/changes/swap-and-save-plan/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Findings

### F1 — Migration not verified on a fresh stack

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20261003120000_plan_choices.sql
- **Detail**: Criterion 1.1 asks for `npx supabase db reset`. CLAUDE.local.md forbids that on the shared local stack, so the migration was applied incrementally with `npx supabase migration up --local`. The full migration chain, including this file, has not been applied from scratch. The partial unique index is safe on existing data, because `mo-delivery.ts:162` flags exactly one recommended option per slot.
- **Fix**: Rely on the CI smoke job, which runs `supabase start` on a fresh stack and applies all migrations, as the fresh-stack check on the PR.
- **Decision**: FIXED — accepted: the CI smoke job (fresh `supabase start`) is the fresh-stack check on the PR

### F2 — Unplanned second not_found guard in choose_plan_option

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20261003120000_plan_choices.sql:160
- **Detail**: After the plan lock, an update that finds no option row raises `not_found`. The guard is reachable. If a re-delivery commits while the choice waits for the plan lock, Postgres rechecks only the locked plan row and keeps the option row it read before the wait, which the re-delivery has deleted. The exception then rolls back the clearing update, so the guard is correct. It isn't in the plan, and pgTAP doesn't cover it, because the test is single-session.
- **Fix**: Keep the guard. The code comment documents it; no change needed.
- **Decision**: FIXED — guard kept as is, no edit

### F3 — Roadmap table realigned in full

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:41-56
- **Detail**: Changing the S-03 status to `in-progress` widened the Status column, and prettier re-padded every row of the "At a glance" table. The parallel F-01 agent edits the F-01 row of the same table, so merging the second branch will probably conflict on that line. The conflict is whitespace-only.
- **Fix**: Resolve at merge by keeping the other branch's status value with the new padding.
- **Decision**: FIXED — resolve the F-01 row at merge time, no edit now
