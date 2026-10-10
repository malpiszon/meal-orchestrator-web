---
change_id: testing-migration-date-rules
title: Testing migration date rules
status: archived
created: 2026-10-10
updated: 2026-10-10
archived_at: 2026-10-10T18:25:08Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Tracking: GitHub issue #116, a single issue with no sub-issues (user's choice, 2026-10-10).
- Before pushing `20261010120000_warsaw_today_helper.sql` to production (Progress 3.7), check that prod has no `private` schema: `select nspname, nspowner::regrole, nspacl from pg_namespace where nspname = 'private'` must return no row. The migration's `create schema private` deliberately has no `if not exists` (impl-review phase 1, F3).
- Progress 2.5 (TS mutation): the fake doesn't implement `gte`, so a literal `gt`→`gte` in `getCurrentPlan` only makes tests throw "not implemented". The check used the equivalent bound `gt("week_start", addDays(today, -8))`, which failed "the week that started 7 days ago is history only". A literal `gte` mutation means something only once the fake implements `gte` (impl-review phase 2, F2).
- CLI spike (Phase 3 step 0, CLI 2.120.0, 2026-10-10):
  - `npx supabase test db <path>` runs files outside `supabase/tests/` (a pass and a deliberate fail in `supabase/replay/` exited 0 and 1), so no `pg_prove`/psql fallback is needed. It runs every `*.sql` in a directory, `seed.sql` included, so the replay script passes `supabase/replay/checks.test.sql`, not the directory.
  - `db reset --version` recreates only the db container and restarts the services that already run (storage, auth, realtime here); the stopped `edge_runtime` container stayed stopped and no missing service was created, so it shouldn't bring back CI's `-x` exclusions. Not provable locally without restarting the shared stack with `-x`; the PR's CI run of the replay step confirms it (Progress 3.3).
  - Confirmed in CI (PR #127, run 38070577041): after `db reset --version` the `-x` services stayed stopped, and the replay passed (checks 8/8, full suite 231).
- Progress 3.7 (2026-10-10): pre-check (no `private` schema on prod), dry run and `db push` done; the dashboard and a rating worked on the old Worker. The swap was not tried on production, to keep the user's real choice. `choose_plan_option`'s signature and grants are pinned by `rpc_contract`, and its cut-off is covered by `date_boundaries` in CI on this migration.
- Progress 3.4: `npx prettier --check .` already fails on master (about 76 pre-existing unformatted files, mostly `context/**/*.md`), so by the user's decision the gate was scoped to the files this change touches.
- Slot-set check (CodeRabbit on #127, 530b66b): "exactly one chosen option per slot" only sees slots that still exist, so a migration dropping all options of an unsaved upcoming slot passed. `replay_snapshot.slots` plus a `set_eq` in `checks.test.sql` now require every seeded slot to survive.
