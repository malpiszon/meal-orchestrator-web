---
date: 2026-11-13T16:37:57+01:00
researcher: alan (with Claude)
git_commit: ef704a553a4c3221051cb4793d4b213990df8365
branch: bump-supabase-3x
repository: meal-orchestrator-web
topic: "What the Supabase CLI 2.x → 3.x bump (Dependabot PR #211) needs in this repo"
tags: [research, supabase-cli, ci, config-toml, deployment, agent-hooks]
status: complete
last_updated: 2026-11-13
last_updated_by: alan (with Claude)
last_updated_note: "Follow-up: hook JSON/error text and MAILPIT_URL settled from CLI v3.1.0 source; status partial → complete"
---

# Research: What the Supabase CLI 2.x → 3.x bump (PR #211) needs in this repo

**Date**: 2026-11-13T16:37:57+01:00
**Researcher**: alan (with Claude)
**Git Commit**: ef704a5 (origin/master)
**Branch**: bump-supabase-3x
**Repository**: meal-orchestrator-web

## Research Question

Dependabot PR #211 bumps the `supabase` dev dependency (the Supabase CLI) from 2.122.0 to 3.1.0. Its CI fails. What breaks, and what else in the repo (config, CI, scripts, agent hooks, docs) must change for v3?

## Summary

- **Why CI fails (observed).** Both the `smoke` and `e2e` jobs on PR #211 stop at `supabase start` with `[inbucket] in supabase/config.toml is no longer supported. Use [local_smtp] instead.` (CI run 43304259814, jobs 131483323867 and 131483323713). `supabase/config.toml:99` still has the `[inbucket]` section that older `supabase init` wrote.
- **Minimum fix (observed with CLI 3.1.0 on isolated config copies).** Renaming `[inbucket]` to `[local_smtp]` is the only config change v3 needs to load this `config.toml`. The empty `[experimental] orioledb_version` (`supabase/config.toml:384`) did not fail, and neither did an app-style root `.env` (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MO_INGEST_TOKEN`). Two deprecation warnings remain: `auth.email.enable_signup` (`:204`) and `auth.sms.enable_signup` (`:246`), both "removed in v4".
- **Production-relevant doc change (from v3.0.0 release notes and `db push --help`).** `db push` now targets the **local** database when given no target. The production migration step in `docs/deployment.md:14-15` (and `context/foundation/infrastructure.md:113`) says `npx supabase db push`. Under v3 that would push to the local stack, and production would not be migrated. It needs `--remote`.
- **Cleanups (deprecated, still working).** `--local` is now a no-op that warns. The repo passes it in `scripts/migration-replay.sh:60,81` and `.claude/hooks/end-of-turn.sh:142,151`, and documents it in `docs/testing.md:53,55,135` and `context/foundation/test-plan.md:163`. `scripts/__tests__/agent-hooks.test.ts:372` asserts the literal `supabase migration up --local`. CI's `INBUCKET_URL` fallback (`.github/workflows/ci.yml:88,103-104,148,153-154`) refers to a variable v3 removed.
- **Agent hook and CI variables keep working (from the CLI v3.1.0 source, see §7).** The end-of-turn hook's `jq '.migrations[]…'` and its error-text match (`.claude/hooks/end-of-turn.sh:142-143,158`) still fit v3.1.0's output. `status -o env` prints `MAILPIT_URL` whenever `[local_smtp]` is enabled and `mailpit` isn't excluded, which holds in CI. So the hook needs no logic change, only an optional `--local` cleanup. CI can drop `INBUCKET_URL`.
- **Left to the plan's verification, not research.** A full CI run (smoke, e2e, migration replay, keepalive) on a v3 branch, and a hook run against your v3 local stack.

## Detailed Findings

### 1. The CI failure and the config fix

- PR #211 (`dependabot/npm_and_yarn/supabase-3.0.0`, title "bump supabase from 2.122.0 to 3.1.0") changes only `package.json` and `package-lock.json`. Its `ci` and `changes` checks pass, while `smoke` and `e2e` fail (`gh pr view 211`).
- CI installs the CLI with `supabase/setup-cli@v3` and no version input, so it uses the version pinned in `package-lock.json` (`.github/workflows/ci.yml:81-82,141-142`). On the PR that version is 3.1.0. The step itself succeeded under Node 22, which meets the action's Node 20+ requirement.
- In both failing jobs, the first CLI call is `supabase start -x …` (`ci.yml:87,147`). It exits 1 with the `[inbucket]` error, and so does the `always()` `supabase stop --no-backup` step (`ci.yml:122,171`).
- The v3.0.0 release notes list `[inbucket]`, `INBUCKET_URL` and `inbucket.url` as removed, replaced by `[local_smtp]`, `MAILPIT_URL` and `mailpit.url`. The keys inside the section stay the same, and v2.108.0 and later already accept `[local_smtp]`. So the rename also works on the current CLI (2.122.0) and could land before the bump.
- Probe, run with CLI 3.1.0 installed in the scratchpad: `supabase status -o env` on copies of `supabase/config.toml` with `project_id` changed to `cfgprobe`, so your running `mo-web` stack was never touched.
  - A, config as-is: the same `[inbucket]` error as CI.
  - B, `[inbucket]` → `[local_smtp]`: config loads. Two `enable_signup` deprecation warnings, then "No such container: supabase_db_cfgprobe" (expected, since no stack was running for that id).
  - C, B plus a root `.env` holding the app's four variables: same result as B.
  - D, B without `orioledb_version`: same result as B.
  - This exercised config loading through `status` only. The other commands load the same config, but they weren't run.
- `supabase/config.toml` has no `[remotes.*]` blocks and no `linkedin`/`slack` providers (`:307-308` is a comment listing provider names), so the other removed-config rows in the release notes don't apply.

### 2. Deprecated `enable_signup` keys (v4 removal)

- `[auth.email] enable_signup = true` (`supabase/config.toml:202-204`) and `[auth.sms] enable_signup = false` (`:244-246`) warn under v3. According to the v3.0.0 notes, these keys always switched the whole provider on or off, not just sign-up. So the equivalent replacements are `[auth.email] enabled = true` and `[auth.sms] enabled = false`. The app-level sign-up switch is `[auth] enable_signup = false` (`:169`), which isn't deprecated.
- `config.toml` only shapes the local and CI stacks. The repo has no `config push` usage (grep over `docs/`, `README.md`, `scripts/`, `.github/`, `context/foundation/`), and production settings are made by hand in the dashboard (`docs/deployment.md:58`). Renaming these keys doesn't change production.

### 3. Command targets: local by default, `--remote`, consent

From the v3.0.0 notes and `--help` output of CLI 3.1.0:

- `db push`, `db reset`, `migration up`, `migration list` and `test db` all print "Local by default. Pass --remote for the linked project". `--local` "does nothing and warns".
- Every command that changes a hosted project asks for confirmation, defaults to No, and fails when unattended unless given `--yes`. A `SUPABASE_YES` in a `.env` file doesn't count.
- `link --project-ref` is still listed in `link --help` without a deprecation note.

Effects on this repo:

| Location                                                           | Current                                                               | Under v3                                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `docs/deployment.md:14-15`                                         | `npx supabase link --project-ref <ref>` then `npx supabase db push`   | `db push` targets **local**. Production needs `npx supabase db push --remote` (interactive confirm, defaults to No). |
| `context/foundation/infrastructure.md:113`                         | same `link` + `db push` wording                                       | same correction                                                                                                      |
| `scripts/migration-replay.sh:60`                                   | `db reset --version "$base" --local`                                  | works, warns. `--local` can go.                                                                                      |
| `scripts/migration-replay.sh:81`                                   | `migration up --local`                                                | works, warns                                                                                                         |
| `scripts/migration-replay.sh:65,85,88`                             | `status -o env`, `test db …`                                          | local by default, no change                                                                                          |
| `.claude/hooks/end-of-turn.sh:142,151`                             | `migration list --local --output-format json`, `migration up --local` | works, warns. Warnings go to stderr (`2>"$TMP/list-err"`) on `:142`, and into `OUT` on `:151`.                       |
| `scripts/__tests__/agent-hooks.test.ts:372`                        | expects the literal `supabase migration up --local`                   | must follow any change to the hook's arguments                                                                       |
| `docs/testing.md:53,55,135`, `context/foundation/test-plan.md:163` | document `--local`                                                    | update if the flag is dropped                                                                                        |

No CI step runs `db push` or `link` (grep over `.github/workflows/ci.yml`). Production migrations are a manual step (`README.md` "Deployment", `docs/deployment.md:14-20`).

### 4. CI service exclusions and status variables

- The `start -x` list `studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor` (`ci.yml:87,147`) is a subset of the names CLI 3.1.0 accepts (`gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`). `mailpit` stays running, as the smoke and e2e jobs need it.
- `ci.yml:88,148` grep `status -o env` for `MAILPIT_URL|INBUCKET_URL`, and `:103-104,153-154` fall back from `MAILPIT_URL` to `INBUCKET_URL` to `http://127.0.0.1:54324`. Per the v3.0.0 removal table, v3 no longer has `INBUCKET_URL`, so that branch (and its "Older CLIs" comment) is dead. v3.1.0 emits `MAILPIT_URL` when `config.local_smtp.enabled` is true and neither the mailpit container nor its image is excluded (`apps/cli/src/command-internal/status-values.ts:32,261,305-306,369-370` at tag v3.1.0). Both conditions hold in CI (`supabase/config.toml:100` `enabled = true`; `-x` list above). So `MAILPIT_URL` alone is enough. The `54324` default remains a harmless safety net.

### 5. Root `.env` is now read by the CLI

- v3 resolves values as "flag > shell env > project env files > config > default", and project env files include `.env` in the project root. The repo's root `.env` (README "Getting started") and the `.env` files CI writes (`ci.yml:94-96,110,155-156`) hold `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- Probe C shows these variables don't fail config loading. That includes the deliberately unreachable `SUPABASE_URL=http://127.0.0.1:1` that CI writes before `npm run test:replay` (`ci.yml:110,120`). Whether any of them silently overrides a config value was not checked beyond "no error".

### 6. Local developer stack

- Your local stack is running from the v2 CLI (`supabase/.temp/cli-latest`: v2.121.0). The linked service versions are recorded in `supabase/.temp/` (gotrue v2.197.0, postgres 17.6.1.166, PostgREST v14.5, storage v1.77.5).
- `project_id = "mo-web"` is set (`supabase/config.toml:5`), so the v3 change that names containers and volumes after the folder when `project_id` is missing doesn't apply. The `supabase_db_mo-web` naming that `scripts/migration-replay.sh:72-77` relies on stays.
- Not verified: whether v3 still applies the `.temp` service-version pins after `link`, which `README.md:46` describes. The v3.1.0 notes only mention that relinking to a different project no longer keeps the old project's versions.

### 7. Agent hook compatibility (CLI v3.1.0 source)

Read from `supabase/cli` at tag `v3.1.0` (fetched via the GitHub API, files under `apps/cli/src/`):

- **`migration list --output-format json`.** The handler calls `output.success("Migrations listed", { migrations: rows })` (`commands/migration/list/list.handler.ts:71-72`). The rows are `{ local, remote, time }`, with `local`/`remote` set to `""` when absent (`commands/migration/list/list.format.ts:8-11,52-62`). In JSON mode, `success` writes `{ ...data, message }`, merged with a `target` object, as one line on stdout (`shared/output/output.layer.ts:599-601,646`). So `.migrations[]` stays top-level and `select((.remote // "") == "") | .local` (`.claude/hooks/end-of-turn.sh:143`) selects the same rows as under v2. The `--local` deprecation warning goes to stderr (JSON mode's `warn` writes stderr, `output.layer.ts:610`), which the hook sends to `$TMP/list-err` and only reads on failure.
- **`migration up` error texts.** v3.1.0 still raises "Remote migration versions not found in local migrations directory." and "Found local migration files to be inserted before the last migration on remote database." (`commands/migration/up/up.handler.ts:77,86`). The hook's case-insensitive `grep -qiE 'inserted before the last migration|migration versions not found'` (`.claude/hooks/end-of-turn.sh:158`) matches both.
- Not run: these are source readings, not a live run of the hook against a v3 stack. Behaviour that only appears at runtime (for example extra stdout lines before the JSON) wouldn't show up here. The hook's own failure path reports that visibly as "could not list the local migrations" (`end-of-turn.sh:146`), so a mismatch couldn't pass silently.

## Code References

- `supabase/config.toml:99` - `[inbucket]` section that v3 rejects
- `supabase/config.toml:204,246` - deprecated `enable_signup` keys in `[auth.email]` / `[auth.sms]`
- `supabase/config.toml:384` - empty `[experimental] orioledb_version` (accepted by 3.1.0)
- `.github/workflows/ci.yml:81-88,141-148` - setup-cli (version from lockfile), `start -x`, `status -o env` grep
- `.github/workflows/ci.yml:103-104,153-154` - `MAILPIT_URL`/`INBUCKET_URL` fallback
- `docs/deployment.md:14-15` - `link --project-ref` + `db push` for production migrations
- `context/foundation/infrastructure.md:113` - same production migration wording
- `scripts/migration-replay.sh:60,81` - `--local` flags
- `.claude/hooks/end-of-turn.sh:142-143` - `migration list --local --output-format json` parsed with `jq '.migrations[] | .remote/.local'`
- `.claude/hooks/end-of-turn.sh:151,158` - `migration up --local` and the error-text match `inserted before the last migration|migration versions not found`
- `scripts/__tests__/agent-hooks.test.ts:372` - asserts `supabase migration up --local`
- `docs/testing.md:53,55,135`, `context/foundation/test-plan.md:163` - document `--local`

## Architecture Insights

- The CLI version is pinned in a single place, `package-lock.json`. Locally `npx supabase`/`node_modules/.bin/supabase` use it, and CI's `setup-cli@v3` reads it. Bumping the lockfile changes every environment at once.
- `config.toml` only configures local and CI stacks. Production is configured by hand through the dashboard, and its migrations go out with a manual `db push`. So the bump's production risk is limited to the `db push` target documented in `docs/deployment.md`.

## Historical Context (from prior changes)

- `context/archive/2026-10-04-password-reset/plan.md:236` added the CI `MAILPIT_URL` wiring "from `supabase status -o env`, or `http://127.0.0.1:54324`". The `INBUCKET_URL` fallback was a compatibility layer for older CLIs and is now removable.
- `context/archive/2026-10-03-email-link-callback/plan.md:104` notes that a bad `content_path` in the shared config stops the shared stack from starting. The same risk applies here: a config edit that v2 or v3 rejects stops your shared local stack and every worktree that uses it.
- No earlier change found that bumped the Supabase CLI across a major version (searched for `inbucket` in `context/archive/`).

## Related Research

Not applicable.

## Open Questions

1. ~~Hook output under v3~~: settled from source (§7). The plan should still run the hook once against the v3 local stack as a check.
2. ~~`MAILPIT_URL` in v3 `status -o env`~~: settled from source (§4).
3. **Full CI under v3.** This is the plan's verification step, not an open research question.
4. **Not blocking.** Does the root `.env` (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) silently override any config value in v3 (§5)? Does v3 still apply the `supabase/.temp` service-version pins described in `README.md:46` (§6)? Neither changes what the plan must edit. The second only affects whether that README sentence stays accurate.
5. **Choices for the plan (yours):**
   - Fix on the Dependabot branch, or land a separate PR from this branch that includes the bump and then close #211.
   - Rename `[inbucket]` in a separate step first. v2.108+ already accepts `[local_smtp]`, so this can land before the version bump.
   - Rename the `enable_signup` keys now or leave them until v4.
   - Drop `--local` everywhere now, or keep it while it only warns.
6. **Shared local stack switchover.** When to `stop` your v2-started stack and `start` it with v3. A rename is needed first, otherwise v3 can't even `stop` it. Possible image pulls, and other worktrees sharing the stack.
