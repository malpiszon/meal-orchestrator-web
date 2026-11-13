# Supabase CLI 2.x → 3.x Bump Implementation Plan

## Overview

Bump the `supabase` dev dependency (the Supabase CLI) from 2.122.0 to 3.1.0 on this branch, together with every repo change v3 needs: the config rename that makes `supabase start` work again, the production `db push --remote` doc fix, and the cleanups of deprecated keys and flags. It ships as one PR from `bump-supabase-3x`; Dependabot PR #211 (same bump, failing CI) is superseded by it.

## Current State Analysis

- PR #211 changes only `package.json`/`package-lock.json`. Its `smoke` and `e2e` jobs fail at `supabase start` with `[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.` (research §1).
- The CLI version is pinned in one place, `package-lock.json`: local `npx supabase` and CI's `supabase/setup-cli@v3` (no version input, `.github/workflows/ci.yml:81-82,141-142`) both read it. Bumping the lockfile switches every environment at once.
- `config.toml` shapes only the local and CI stacks; production is configured by hand in the dashboard and migrated with a manual `link` + `db push` (`docs/deployment.md:11-18`).
- Your local stack is shared with your dev server on :4321 and was started by the v2 CLI. Only one worktree exists today.

## Desired End State

- `package.json`/`package-lock.json` pin `supabase` 3.1.0; CI (`ci`, `smoke`, `e2e`, including the migration replay and keepalive smoke) is green on the PR.
- `supabase start` / `status` under v3 print no config errors or deprecation warnings, and no repo script prints the `--local` deprecation warning.
- The production migration step in the docs reads `npx supabase db push --remote`, so following it under v3 migrates production, not the local stack.
- Your local stack runs on v3 with its data intact, and the end-of-turn hook's migration listing works against it.
- #211 is closed as superseded after this PR merges.

### Key Discoveries:

- `supabase/config.toml:99` `[inbucket]` is the only thing v3 rejects; the keys inside stay the same, and v2.108+ also accepts `[local_smtp]` (research §1).
- `supabase/config.toml:204` (`[auth.email] enable_signup = true`) and `:246` (`[auth.sms] enable_signup = false`) warn under v3 ("removed in v4"); they always toggled the whole provider, so the replacements are `enabled = true` / `enabled = false`. `[auth] enable_signup = false` (`:169`) is not deprecated and stays (research §2).
- Under v3, `db push` with no target pushes to the **local** database; hosted-project commands ask for confirmation (default No) (research §3).
- `--local` is a warning no-op in v3: `scripts/migration-replay.sh:60,81`, `.claude/hooks/end-of-turn.sh:142,151`; the hook test asserts the literal `supabase migration up --local` (`scripts/__tests__/agent-hooks.test.ts:372`); documented in `docs/testing.md:53,55,135`.
- Under **v2**, `migration list` defaults to the linked (production) project and `db push` has no `--remote`. So dropping `--local` and documenting `--remote` are only correct together with the lockfile bump.
- v3.1.0 still emits `.migrations[]` with `{local, remote}` rows and the same `migration up` error texts the hook matches (`end-of-turn.sh:143,158`; research §7). `status -o env` prints `MAILPIT_URL` in CI, so the `INBUCKET_URL` fallback (`ci.yml:88,103-104,148,153-154`) is dead (research §4).

## What We're NOT Doing

- No change to app code, migrations, or production Supabase settings; `config.toml` doesn't reach production (no `config push` in the repo).
- No historical rewrite: `context/foundation/test-plan.md:163` (Phase 5 rollout note) and archived plans keep their `--local` wording; they record what was done.
- Not running `npm run test:replay` locally: it wipes the local database; CI runs it on the PR.
- Not removing the `http://127.0.0.1:54324` default in CI: it's a harmless safety net (research §4).
- No roadmap entry: this is a Dependabot follow-up tracked outside the roadmap, as a non-roadmap issue (#212) with phase sub-issues, like #203.
- Not investigating whether the root `.env` silently overrides config values under v3 beyond the end-to-end checks below (research §5, non-blocking).

## Implementation Approach

All file edits land in one commit (Phase 1), because every one of them is either required by v3 or wrong under v2. The local stack is stopped with the v2 CLI before the lockfile changes, so the switch never depends on v3 stopping a v2-started stack; Phase 2 starts it on v3, verifies locally, then ships through CI.

## Critical Implementation Details

- **Stack switchover order.** After renaming `[inbucket]` (which v2.122 accepts) and before `npm install -D supabase@3.1.0`, run `npx supabase stop` with the v2 CLI, **without** `--no-backup`, so the `supabase_db_mo-web` volume and your local data survive. Your dev server on :4321 has no database until Phase 2 starts the stack again.
- **Closing #211.** Don't close #211 before this PR merges: closing a Dependabot PR by hand makes Dependabot ignore that version. After the merge, Dependabot normally closes #211 itself as already up to date; close it manually (with a "superseded by #<this PR>" comment) only if it is still open a day later.
- **Reverting.** Because the hook's `migration list` loses `--local`, a rollback to v2 must revert the whole Phase 1 commit, never just the lockfile; otherwise the hook would list migrations against the linked production project.

## Phase 1: Bump the CLI and make the repo v3-ready

### Overview

One commit with the lockfile bump and every config, script, CI and doc change v3 needs.

### Changes Required:

#### 1. Supabase config

**File**: `supabase/config.toml`

**Intent**: Make v3 load the config without errors or deprecation warnings.

**Contract**: section `[inbucket]` → `[local_smtp]` (keys and comment unchanged; `enabled = true`, `port = 54324`); `[auth.email] enable_signup = true` → `enabled = true` and `[auth.sms] enable_signup = false` → `enabled = false`, with their comment lines reworded to say they switch the provider on/off; `[auth] enable_signup = false` untouched.

#### 2. Stop the local stack (v2), then bump the CLI

**File**: `package.json`, `package-lock.json`

**Intent**: Pin the CLI at 3.1.0 after stopping the v2-started stack (see Critical Implementation Details).

**Contract**: `npx supabase stop` (v2, volumes kept), then `npm install -D supabase@3.1.0`; `devDependencies.supabase` = `^3.1.0` (or the range style the file already uses), lockfile resolves 3.1.0.

#### 3. Scripts and the agent hook

**File**: `scripts/migration-replay.sh`, `.claude/hooks/end-of-turn.sh`, `scripts/__tests__/agent-hooks.test.ts`

**Intent**: Drop the no-op `--local` flag so replays and the hook print no warnings; keep the hook test asserting the real command line.

**Contract**: `db reset --version "$base"` (`migration-replay.sh:60`), `migration up` (`:81`), `migration list --output-format json` (`end-of-turn.sh:142`), `migration up` (`:151`); hook test expects `supabase migration up` exactly (assert the command line, not a prefix match that would also accept `--local`). The hook's `jq` filter and error-text match stay unchanged.

#### 4. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Remove the `INBUCKET_URL` compatibility path that v3 no longer feeds.

**Contract**: both `status -o env` greps keep `API_URL|ANON_KEY|SERVICE_ROLE_KEY|MAILPIT_URL`; both fallbacks become `MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}"`, with the "Older CLIs…" comment replaced by one naming 54324 as `[local_smtp]`'s port. Service exclusions (`-x …`) unchanged.

#### 5. Docs

**File**: `docs/deployment.md`, `context/foundation/infrastructure.md`, `docs/testing.md`

**Intent**: Make the production migration step target production under v3, and document the scripts as they now run.

**Contract**: `docs/deployment.md` migrations block: `npx supabase db push --remote`, plus one sentence that it asks for confirmation (answer yes) and that without `--remote` it pushes to the local stack; `infrastructure.md:113` wording → `… + npx supabase db push --remote`; `docs/testing.md:53,55,135` drop `--local` from the quoted commands.

### Success Criteria:

#### Automated Verification:

- `npx supabase --version` prints 3.1.0
- `npx supabase status -o env` prints no `[inbucket]` error and no `enable_signup` deprecation warning (stack stopped is fine)
- `grep -rn -- '--local\|INBUCKET' scripts .claude/hooks .github docs` finds nothing
- Unit tests pass, including the agent-hooks test: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- `docs/deployment.md` and `infrastructure.md` read `db push --remote` for production

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Switch the local stack to v3, verify, ship

### Overview

Start your local stack on v3, verify it and the hook against it, then push, open the PR and get CI green.

### Changes Required:

#### 1. Start the local stack on v3

**File**: none (local environment)

**Intent**: Bring your shared stack back on v3 with the same data.

**Contract**: `npx supabase start`; `.env`/`.dev.vars` values from `npx supabase status -o env` still match (keys unchanged unless v3 regenerated them; if they changed, update both files).

#### 2. README service-version note

**File**: `README.md:46`

**Intent**: Keep the sentence about linked service versions accurate under v3.

**Contract**: compare the running PostgREST/gotrue/postgres images (`docker ps --format '{{.Image}}'`) with `supabase/.temp/{rest,gotrue,postgres}-version`; if they match, leave the sentence; if not, reword it to what v3 does. Only edit (and commit) when they differ.

#### 3. PR

**File**: none (GitHub)

**Intent**: Ship the bump through CI and supersede #211.

**Contract**: push `bump-supabase-3x`, open a PR to `master` whose body contains `Closes #212`, says it supersedes #211 and lists the production-facing change (`db push --remote`); no `Closes #211` (see Critical Implementation Details).

### Success Criteria:

#### Automated Verification:

- `npx supabase start` succeeds with no config errors or deprecation warnings
- pgTAP passes on the v3 stack, full output saved to a log: `npx supabase test db > "$TMP/pgtap.log" 2>&1`
- The hook's listing pipeline works on v3: `node_modules/.bin/supabase migration list --output-format json | jq -er '[.migrations[] | select((.remote // "") == "") | .local] | join(" ")'` exits 0 and prints an empty line
- `node_modules/.bin/supabase migration up` exits 0 with nothing to apply
- Smoke passes against a preview on :4322: `npm run build && npm run preview -- --port 4322` then `BASE_URL=http://localhost:4322 npm run smoke`
- PR CI is green: `ci`, `smoke` (incl. keepalive smoke and migration replay) and `e2e`

#### Manual Verification:

- Your local data survived the switch: the dashboard on :4321 shows your delivered weeks
- Mailpit at `http://127.0.0.1:54324` shows the smoke's password-reset email
- README:46 checked against the running service versions (edited only if they differ)
- After merge, #211 is closed (by Dependabot, or manually with a "superseded" comment)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `scripts/__tests__/agent-hooks.test.ts`: the `migration up` assertion matches the new command line exactly; the rest of the suite (stubbed CLI) unchanged.

### Integration Tests:

- CI on the PR: `supabase start -x …` on v3, pgTAP, smoke (reads Mailpit via `MAILPIT_URL`), keepalive failure-mode smoke, migration replay (exercises `db reset --version` and `migration up` without `--local`), e2e (reads the invitation from Mailpit).

### Manual Testing Steps:

1. After `npx supabase start` on v3, open :4321 and confirm your weeks are there.
2. Run the hook's listing pipeline and `migration up` by hand (Phase 2 criteria).
3. Smoke on :4322 and check Mailpit.

## Migration Notes

No schema change. The only production-facing change is the documented command: the next production migration must use `npx supabase db push --remote` and confirm the prompt. Rollback = revert the Phase 1 commit as a whole.

## References

- Related research: `context/changes/bump-supabase-3x/research.md`
- Issue: #212; phase sub-issues: #213 (Phase 1), #214 (Phase 2)
- Dependabot PR: #211 (`dependabot/npm_and_yarn/supabase-3.0.0`)
- Prior Mailpit wiring: `context/archive/2026-10-04-password-reset/plan.md:236`
- Lessons applied: `context/foundation/lessons.md` (pgTAP output to a log; no stale preview before e2e)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bump the CLI and make the repo v3-ready

#### Automated

- [x] 1.1 `npx supabase --version` prints 3.1.0 — 2f9c9b8
- [x] 1.2 `npx supabase status -o env` prints no `[inbucket]` error and no `enable_signup` deprecation warning — 2f9c9b8
- [x] 1.3 No `--local` or `INBUCKET` left in scripts, hooks, CI or docs — 2f9c9b8
- [x] 1.4 Unit tests pass, including the agent-hooks test: `npm test` — 2f9c9b8
- [x] 1.5 Lint passes: `npm run lint` — 2f9c9b8

#### Manual

- [x] 1.6 `docs/deployment.md` and `infrastructure.md` read `db push --remote` for production — 2f9c9b8

### Phase 2: Switch the local stack to v3, verify, ship

#### Automated

- [x] 2.1 `npx supabase start` succeeds with no config errors or deprecation warnings — 1f5f151
- [x] 2.2 pgTAP passes on the v3 stack, full output saved to a log — 1f5f151
- [x] 2.3 The hook's listing pipeline works on v3 — 1f5f151
- [x] 2.4 `node_modules/.bin/supabase migration up` exits 0 with nothing to apply — 1f5f151
- [x] 2.5 Smoke passes against a preview on :4322 — 1f5f151
- [x] 2.6 PR CI is green: `ci`, `smoke` and `e2e` — 1f5f151

#### Manual

- [x] 2.7 Your local data survived the switch — 1f5f151
- [x] 2.8 Mailpit shows the smoke's password-reset email — 1f5f151
- [x] 2.9 README:46 checked against the running service versions — 1f5f151
- [ ] 2.10 After merge, #211 is closed
