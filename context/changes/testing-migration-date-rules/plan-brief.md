# Migration and Date-Rule Safety — Plan Brief

> Full plan: `context/changes/testing-migration-date-rules/plan.md`
> Research: `context/changes/testing-migration-date-rules/research.md`

## What & Why

This is test-plan §3 Phase 1:

- **Risk #1:** a migration runs on the hosted database before its code merges and breaks a plan rule or the old Worker.
- **Risk #5:** the date rules (cut-off, rating window, This/Next week) go wrong at their boundaries.

Today's pgTAP tests compute "today" with the same expression the SQL uses, so a regression to UTC fails only if CI happens to run between 22:00 and 24:00 UTC.

## Starting Point

- Four live SQL functions write the Warsaw "today" inline, and none of their callers can override it.
- The pgTAP tests use dates relative to the real today.
- Week selection is tested only by pinning query arguments.
- CI runs the tests on an empty database, with no migration replay and no check of the deploy-window contract.

## Desired End State

- A single `private.warsaw_today()` that tests can pin.
- Boundary tests that fail on every run if a rule drifts by a day or a time zone.
- A pgTAP contract that keeps the previous Worker working during the deploy window.
- A CI replay that applies each new migration over seeded rows, then checks that the PRD rules and saved data still hold.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Oracle | PRD and `docs/api.md`; "today" = Warsaw date | Expected values must not come from the SQL under test | Research |
| SQL clock | Helper `private.warsaw_date(ts)` plus `warsaw_today()`; the 4 functions call it; tests replace it inside a rolled-back transaction | Real signal without a test-only override in production | Plan |
| Bypass guard | pgTAP: no other live function derives a date (`at time zone`, `current_date`) | A new date check outside the helper fails at once | Plan |
| Pinned today | 2026-03-30, months before the real date | A function bypassing the helper disagrees on every run | Plan |
| Replay | Reusable harness: reset to the previous version, seed via RPCs, snapshot, apply the newest, check; CI smoke job; local runs need an opt-in flag | Protects every future migration; never wipes the shared dev stack by accident | Plan |
| Old Worker | pgTAP contract on RPC names, args, returns, grants and read columns | Cheap, and catches a drop, rename or grant change | Plan |
| Week selection | Vitest with an in-memory PostgREST fake that throws on unknown methods | Runs in `npm test` and would have caught the 2026-10-08 nearest-week bug | Plan |
| Phase count | 3 phases | User asked for coarser phases | Plan |

## Scope

**In scope:**

- Helper migration and its guard.
- RPC contract test.
- `date_boundaries.test.sql`: T+1, T and T-1 for the cut-off and `week_started`; T+1, T, T-7 and T-8 for the rating window; the re-pick.
- Fake builder and week-selection tests.
- Replay seed, checks, script and CI step.
- `docs/testing.md` and the test-plan cookbook.

**Out of scope:**

- Converting the existing relative-date pgTAP files.
- Retroactive replays of already-shipped migrations.
- Running the old `master` Worker's smoke against the new schema.
- Moving week selection into SQL.
- A per-user time zone and tzdata pinning.
- GitHub sub-issues (this change has no roadmap item).

## Architecture / Approach

**SQL write rules** call one helper. A test pins the helper to a fixed past date, and fixtures use absolute dates around it.

**TS read rules** are already driven by a `today` parameter, so the tests feed fixed dates through a row-filtering fake.

**Replay** uses the Supabase CLI: `db reset --version`, then a seed through the stable RPCs, then `migration up`, then `test db` on the replay checks and on the suite. Its first run replays this branch's own helper migration.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. RPC contract and Warsaw "today" helper | Contract test; helper migration rewriting 4 functions; helper and guard tests | The rewrite changes behaviour; the contract and existing rule tests must stay green |
| 2. Date-boundary tests | Pinned-today pgTAP; fake builder plus week-selection Vitest | PL/pgSQL plan caching when pinning; the fake drifting from PostgREST |
| 3. Migration replay in CI, docs and cookbook | Seed, checks, `scripts/migration-replay.sh`, CI step, docs | Seed rows colliding with test fixtures; added CI time |

**Prerequisites:** Local Supabase running (Docker). Replay runs locally only with `MIGRATION_REPLAY_WIPES_LOCAL_DB=1`.
**Estimated effort:** About 2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Pinning relies on replacing `private.warsaw_today()` as `postgres`, the owner, before any role switch. The first assertion proves the pin took effect.
- Two CLI behaviours are unverified: `test db` running a path outside `supabase/tests/`, and `db reset` keeping the `-x` exclusions. Phase 3 opens with a spike. The replay script falls back to `docker exec … psql` when psql isn't installed.
- The seed is valid back to `20261008180000` only, the first version where every RPC it calls exists.
- The default replay base is the second-newest migration. A PR adding two migrations must pass an older base by hand.
- The helper migration is pushed to production before merging. It should be behaviour-neutral, and a manual check on the old Worker confirms that.

## Success Criteria (Summary)

- A function switched to `current_date` or UTC fails `date_boundaries` at any time of day.
- A migration that drops or renames an RPC argument, or changes saved choices on existing rows, fails CI before it reaches production.
- Next week, This week and history are proven against rows at the T-7, T-6, T and T+1 edges.
