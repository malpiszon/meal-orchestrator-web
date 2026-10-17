# Data isolation sweep (test-plan Phase 3): Plan Brief

> Full plan: `context/changes/testing-data-isolation/plan.md`
> Research: `context/changes/testing-data-isolation/research.md`

## What & Why

These tests prove that a second signed-in user can't read or change another user's plans, choices or ratings, through the app routes or by calling the database API directly with their own session. They also make a future table, function or grant that leaks fail a test. This is S-03 (#121), test-plan risk #3. It challenges the idea that "RLS is on, so it's safe": security definer functions skip RLS.

## Starting Point

Nothing leaks today:

- 3 tables with select-only RLS and no write grants
- 3 security definer functions that `authenticated` can call, each of which checks `auth.uid()`
- the id- and email-taking definer functions are limited to `service_role`

The risk is ahead. Supabase's default privileges grant anon and authenticated everything on new objects in `public`, and no test fails on an object it doesn't name. Cross-user pgTAP coverage is partial, and the smoke never signs in a second user.

## Desired End State

Three layers fail on a leak:

- **Allowlist:** a pgTAP snapshot of everything the public keys can reach.
- **pgTAP sweep:** acts as user B and anon against user A's real data.
- **Smoke:** a second signed-in user sends A's real ids to every app route that takes one, and calls `/rest/v1` directly with their own token.

The test plan's §6.3 says how to extend all three.

## Key Decisions Made

| Decision                                        | Choice                                                                                            | Why (1 sentence)                                                                                         | Source   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Migrations                                      | None                                                                                              | No leak was found; the gap is tests.                                                                     | Research |
| Leak guard for future objects                   | Exact snapshot allowlist (relations, RLS, policies, grants, callable functions with definer flag) | Any new or loosened object fails until someone adds it deliberately, which is the outcome #121 asks for. | Plan     |
| Child-row `user_id` (RLS checks the row's copy) | pgTAP invariant, no constraint                                                                    | Catches a wrong writer without a migration, a separate stack or a deploy step.                           | Plan     |
| `adjusted_score` executable by authenticated    | Allowed in the allowlist                                                                          | It's pure arithmetic; revoking would need a migration.                                                   | Research |
| HTTP check placement                            | Extend `scripts/smoke.mjs` after S-02 merges; pgTAP phases first                                  | One smoke script and no throwaway code, and the stream isn't paused.                                     | Plan     |
| Direct database-API calls                       | Yes: B's own token against `/rest/v1` tables and RPCs                                             | This is the path risk #3 names, which pgTAP's `set role` can't exercise.                                 | Plan     |
| Prod GraphQL and realtime                       | Manual catalog check, recorded on #121                                                            | Only the local stack was inspected.                                                                      | Research |

## Scope

**In scope:**

- `supabase/tests/exposed_surface.test.sql`
- `supabase/tests/second_user_isolation.test.sql`
- second-user and `/rest/v1` steps in `scripts/smoke.mjs`
- test-plan §3, §5, §6.3, §6.5 and `docs/testing.md` (plus `docs/deployment.md` if prod has pg_graphql)

**Out of scope:**

- migrations and constraints
- changes to `rpc_contract.test.sql` or the existing cross-user tests
- e2e isolation checks
- second-user checks against prod
- app route changes

## Architecture / Approach

**pgTAP.** The allowlist defines the closed set of objects a second user can reach. The sweep acts as B and anon on each of them, with today pinned (`private.warsaw_today()` replaced in the transaction). It builds A's and B's data through the real RPCs, so the `user_id` invariant is checked on rows the app actually writes.

**Smoke.** The smoke repeats the attacks through the Worker routes, including confirm (not covered today) and choose with B's own option plus A's `planId`. It also repeats them through PostgREST with a GoTrue password-grant token.

## Phases at a Glance

| Phase                            | What it delivers                                                                           | Key risk                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1. Exposed-surface allowlist     | Exact pgTAP snapshot; prod catalog check                                                   | Snapshot accidentally covers locally-only objects (`replay_snapshot`, extension functions) |
| 2. Second-user sweep (pgTAP)     | B and anon get nothing and change nothing on every allowlisted object; `user_id` invariant | Fixed UUIDs clash with other worktrees on the shared stack                                 |
| 3. Second-user HTTP pass (smoke) | Routes and `/rest/v1` refuse B with A's ids                                                | Blocked by S-02 (#120); its smoke reshape changes where steps go                           |
| 4. Test-plan and docs upkeep     | §3 row 3 complete, §6.3 recipe, `docs/testing.md`                                          | Conflicts with S-02 Phase 4 if started before it merges                                    |

**Prerequisites:**

- local Supabase at all 12 migrations
- S-02 merged before Phases 3–4
- dashboard access for the prod catalog check

**Estimated effort:** about 3–4 sessions across 4 phases; Phases 1–2 can start now.

## Open Risks & Assumptions

- **Prod might expose pg_graphql**, which local doesn't. pg_graphql still applies the same grants and RLS, but the allowlist would then not mirror prod exactly. Phase 1's manual check settles this.
- **S-02 may stall.** If it does, Phase 3 waits; its sub-issue carries a Blocked-by link to #120.
- **Migration authors take on a new step:** every migration that adds a table or RPC must also edit `exposed_surface.test.sql`. §6.3 documents it, and CI enforces it.

## Success Criteria (Summary)

- A deliberately leaking grant, policy or function fails `npx supabase test db` with a diff that names it.
- A second signed-in user gets 404s, empty results or 42501 on every route and database-API call that takes A's ids, and A's state is unchanged.
- The test plan shows Phase 3 complete, with a cookbook for the next table, function or route.
