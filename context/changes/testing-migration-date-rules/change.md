---
change_id: testing-migration-date-rules
title: Testing migration date rules
status: impl_reviewed
created: 2026-10-10
updated: 2026-10-10
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Tracking: GitHub issue #116, a single issue with no sub-issues (user's choice, 2026-10-10).
- Before pushing `20261010120000_warsaw_today_helper.sql` to production (Progress 3.7), check that prod has no `private` schema: `select nspname, nspowner::regrole, nspacl from pg_namespace where nspname = 'private'` must return no row. The migration's `create schema private` deliberately has no `if not exists` (impl-review phase 1, F3).
