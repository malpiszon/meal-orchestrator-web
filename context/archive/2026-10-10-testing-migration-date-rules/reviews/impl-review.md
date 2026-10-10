<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Migration and Date-Rule Safety

- **Plan**: context/changes/testing-migration-date-rules/plan.md
- **Scope**: Full plan (phases 1–2 were already reviewed in `impl-review-phase-1.md` and `impl-review-phase-2.md`; this pass goes deep on Phase 3 and checks across phases)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated, rerun for this review:

- `npx supabase test db`: 9 files / 231 tests, PASS.
- `npm test`: 180 passed.
- `npm run lint`: 0 errors.
- `npx astro check`: 0 errors.
- `npm run test:replay` without the opt-in: exit 1.
- PR #127 CI on 6fec745 is green, including the replay step.

The local replay passes, and the CI runs 38070577041 and 38071824656 pass it as well.

Manual: 3.5–3.7 are ticked with evidence. The 3.5 negative runs are in the scratch logs. The 3.7 swap was not tried on prod, and `change.md` says so.

## Findings

### F1 — CI replays only the newest migration, not all of a PR's migrations

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/migration-replay.sh:36, .github/workflows/ci.yml:109-110
- **Detail**: CI runs the script with no argument, so the base is always the second-newest file. When a PR adds two migrations, `db reset` applies the first one before the seed runs, so that migration never runs over existing rows. A PR without a migration re-checks one that is already deployed, which is harmless. The script header says "newest migration(s)", and neither it nor the docs state this limit.
- **Fix A ⭐ Recommended**: Document the one-migration limit in `docs/testing.md` "Migration replay" and in the script header. A PR with several migrations runs `scripts/migration-replay.sh <master's newest>` locally.
  - Strength: The plan's contract defines the default base as the second-newest file. Migrations here usually arrive one per PR (roadmap slices).
  - Tradeoff: Relies on the author remembering to do it for multi-migration PRs.
  - Confidence: HIGH — a two-line docs change.
  - Blind spot: None significant.
- **Fix B**: In CI, compute the base as the newest migration on `origin/master` (`git ls-tree`, which needs a fetch of master) and pass it as `$1`. Fall back to the default when the PR adds no migration.
  - Strength: Covers every migration the PR adds, automatically.
  - Tradeoff: Adds git plumbing to CI. A PR adding a migration older than master's newest is an edge case it would handle oddly.
  - Confidence: MED — not yet tried in this workflow's checkout setup.
  - Blind spot: How the shallow checkout interacts with fetching master.
- **Decision**: FIXED via Fix A — one-migration default documented in docs/testing.md "Migration replay" and the script header; a PR adding several migrations also runs it with master's newest as base

### F2 — The opt-in guard trusts `CI=true` alone

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/migration-replay.sh:20
- **Detail**: In a developer shell that exports `CI=true` (some people set it to keep tools non-interactive), the script wipes the shared local database without asking. Nothing here exports it today.
- **Fix**: Set `MIGRATION_REPLAY_WIPES_LOCAL_DB: 1` as the CI step's `env:`, drop the `CI` branch, and update the docs and the comment at ci.yml:108.
- **Decision**: FIXED — the script accepts only MIGRATION_REPLAY_WIPES_LOCAL_DB=1; the CI step sets it as env; docs and comment updated. `CI=true` alone now exits 1

### F3 — The base-version check treats its argument as a regex

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/migration-replay.sh:37 (also :51)
- **Detail**: `grep -qx "$base"` reads the argument as a regex, so `[2-9].*` passes the membership check, and an argument starting with `-` is parsed as a grep option. This is not an injection: the value is always quoted, and `db reset --version` rejects junk. `printf … $replayed` on line 51 is unquoted (SC2086), which is safe only because the earlier sed filter lets through only 14-digit versions.
- **Fix**: Validate `[[ $base =~ ^[0-9]{14}$ ]]` before the membership check, and use `grep -qxF --`.
- **Decision**: FIXED — 14-digit check before `grep -qxF --`; `$replayed` quoted. `[2-9].*` and `-x` are refused

### F4 — A local replay leaves a `replay_snapshot` schema behind, and the docs don't say so

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/replay/seed.sql:158, docs/testing.md "Migration replay"
- **Detail**: After a local run, the schema and its tables stay in the database until the next reset. The tables have no RLS, and the schema isn't exposed. A later `supabase db diff` could pull them into a generated migration.
- **Fix**: State in the docs sentence about what's left afterwards that `replay_snapshot` remains until the next `db reset`.
- **Decision**: FIXED — docs say `replay_snapshot` stays until the next `db reset`

### F5 — Header prefixes of the new SQL files don't match the existing ones, and one says "Phase 2"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: line 1 of supabase/tests/{rpc_contract,warsaw_today,date_boundaries}.test.sql and supabase/replay/{seed.sql,checks.test.sql}
- **Detail**: The existing test files start with the roadmap ID (`-- S-02:`, `-- S-13:`). The new ones start with `-- Test-plan Phase 1 (testing-migration-date-rules):`. `date_boundaries` says "Test-plan Phase 2", but this is test-plan Phase 1; plan phase 2 is meant. The roadmap now names this change S-01.
- **Fix**: Use `-- S-01 (testing-migration-date-rules):` in all five files.
- **Decision**: FIXED — all five headers start `-- S-01 (testing-migration-date-rules):`

### F6 — Two decisions aren't recorded in the change folder

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-migration-date-rules/change.md Notes
- **Detail**: Progress 3.4 is ticked as "`npx prettier --check .` reports no changes". The check was in fact scoped to the files this change touched, by the user's decision, because `prettier --check .` already fails on master on about 76 pre-existing files. The slot-set check (from CodeRabbit on #127) is explained only in the 530b66b commit message.
- **Fix**: Add one Notes line for each.
- **Decision**: FIXED — two change.md Notes lines (3.4 prettier scope, slot-set check)

### F7 — Test-plan §4 still counts 6 pgTAP files

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:87
- **Detail**: `supabase/tests/` now has 9 files. §4 is the strategy snapshot written when the plan was created, so updating it is optional.
- **Fix**: Change "6 files" to "9 files", or leave it as a dated snapshot.
- **Decision**: FIXED — §4 Stack row and test-base profile say 9 pgTAP files
