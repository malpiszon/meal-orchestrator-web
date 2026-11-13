# Supabase CLI 2.x → 3.x Bump — Plan Brief

> Full plan: `context/changes/bump-supabase-3x/plan.md`
> Research: `context/changes/bump-supabase-3x/research.md`
> Issue: #212 (phases #213, #214)

## What & Why

Dependabot PR #211 bumps the `supabase` dev dependency (the Supabase CLI) from 2.122.0 to 3.1.0. Its CI fails because v3 rejects the `[inbucket]` section in `supabase/config.toml`. v3 also changes `db push` to target the **local** database by default, so the production migration step in the docs would silently stop migrating production. This change makes the bump and everything v3 needs in one PR.

## Starting Point

The CLI version is pinned once, in `package-lock.json`, and both local `npx supabase` and CI's `setup-cli@v3` use it. `config.toml` only shapes the local and CI stacks. Production is migrated by hand with `link` + `db push` (`docs/deployment.md`). Your local stack, shared with the dev server on :4321, was started by v2.

## Desired End State

The CLI is pinned at 3.1.0 and CI is green. v3 loads the config with no errors or deprecation warnings, and no script passes the no-op `--local`. The docs say `npx supabase db push --remote` for production. Your local stack runs on v3 with its data intact, and #211 is closed as superseded.

## Key Decisions Made

| Decision                          | Choice                                          | Why (1 sentence)                                                                                       | Source   |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| Config fix                        | `[inbucket]` → `[local_smtp]`, keys unchanged   | It's the only thing v3 rejects; probed with CLI 3.1.0 on config copies.                                | Research |
| Production migration doc          | `db push --remote` (confirm the prompt)         | Without it, v3 pushes to the local stack and production is never migrated.                             | Research |
| CI `INBUCKET_URL` fallback        | Remove; keep the 54324 default                  | v3 always prints `MAILPIT_URL` in CI; the default is a harmless safety net.                            | Research |
| Delivery                          | Own PR from `bump-supabase-3x`; #211 superseded | One branch you control with the context folder and phase commits; Dependabot won't force-push over it. | Plan     |
| `enable_signup` keys (email, SMS) | Rename to `enabled` now                         | Removes two warnings on every CLI call and avoids a second config migration at v4; local/CI only.      | Plan     |
| `--local` flag                    | Drop it in the same commit as the bump          | It's a warning no-op in v3; under v2 `migration list` would hit the linked project, so not earlier.    | Plan     |
| Closing #211                      | After merge, by Dependabot or by hand           | Closing a Dependabot PR by hand before then makes Dependabot ignore that version.                      | Plan     |

## Scope

**In scope:**

- Lockfile bump to 3.1.0 and the `config.toml` edits (`[local_smtp]`, `enabled`)
- `--local` removed from `migration-replay.sh`, `end-of-turn.sh` and the hook test; `--local` mentions removed from `docs/testing.md`
- `INBUCKET_URL` removed from `ci.yml`
- `db push --remote` in `docs/deployment.md` and `context/foundation/infrastructure.md`
- Switching the local stack to v3, verifying it, and fixing `README.md:46` if the service-version pins no longer apply

**Out of scope:** app code, migrations, production settings; rewriting historical notes (`test-plan.md:163`, archives); running the database-wiping `test:replay` locally (CI does); a roadmap entry (tracked as issue #212 with phase sub-issues #213, #214).

## Architecture / Approach

Every file edit is either required by v3 or wrong under v2, so all of them go in one commit. Before the lockfile changes, the local stack is stopped with v2, keeping its volumes. Phase 2 starts it on v3, checks it against the end-of-turn hook's own commands and the smoke, then ships through CI. The smoke, e2e and migration-replay jobs there exercise Mailpit, `db reset --version` and `migration up` without `--local`.

## Phases at a Glance

| Phase                                         | What it delivers                                              | Key risk                                                               |
| --------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Bump the CLI and make the repo v3-ready    | One commit: lockfile, config, scripts, hook test, CI, docs    | Stopping the stack with `--no-backup` by mistake would lose local data |
| 2. Switch the local stack to v3, verify, ship | v3 stack with data intact, hook pipeline checked, green PR CI | A v3 runtime difference the source reading missed (hook, replay, e2e)  |

**Prerequisites:** Docker running; no other worktree using the shared stack during the switch.
**Estimated effort:** ~1 session across 2 phases, plus the CI wait.

## Open Risks & Assumptions

- The hook's v3 compatibility rests on a reading of the v3.1.0 source. Phase 2 runs its listing pipeline against the live stack.
- v3 may regenerate local keys on `start`. If it does, `.env`/`.dev.vars` need the new values.
- Unknown: whether v3 still applies the `supabase/.temp` service-version pins. Phase 2 checks the running images and fixes `README.md:46` if needed.
- A rollback to v2 must revert the whole Phase 1 commit, not only the lockfile.

## Success Criteria (Summary)

- PR CI (`ci`, `smoke`, `e2e`) is green on CLI 3.1.0, and #211 ends closed as superseded.
- The next production migration that follows `docs/deployment.md` actually migrates production.
- Local work on the v3 stack is quiet (no deprecation warnings) and your data is unchanged.
