# Recency notes from saved plans only — Plan Brief

> Full plan: `context/changes/recency-from-saved-plans/plan.md`

## What & Why

Recency notes ("In your plan N days earlier") must come only from plans the user saved (swapped at least once, or kept as recommended). First user feedback showed MO's top picks of a week the user ignored read as meals they had eaten; better no reminder than a false one (PRD FR-008 update, 2026-10-06).

## Starting Point

`get_plan_recency` counts any earlier chosen option in any plan, saved or not. Since MO's recommendations are chosen by default, a never-saved week produces notes. The dashboard and save routes just render what the function returns.

## Desired End State

A meal has a note only when its latest earlier occurrence is in a saved plan. Unsaved past weeks, weeks delivered too late to edit, and the upcoming plan's own earlier days while unsaved give none; saving a plan makes it count at once. No dashboard hint, no data migration.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Where the rule lives | New migration adding `hp.saved_at is not null` to `get_plan_recency` | Matching already runs in Postgres; no TS change | Plan |
| Existing history | Judged by `saved_at` at query time, no backfill | Issue: "existing history needs no data migration" | Roadmap |
| Dashboard hint | None | Status line already says "Not saved yet" | Roadmap |
| Smoke history source | The saved upcoming week; a later week carries the note | A current-week plan can never be saved | Plan |
| Stale "Keep as recommended" | Stays parked | Out of scope | Roadmap |

## Scope

**In scope:** migration, pgTAP test, smoke script, README rule and walkthrough, roadmap status.

**Out of scope:** UI changes, save/ingest functions, hints, backfill.

## Architecture / Approach

One predicate in the SQL function; everything else (tests, smoke, docs) follows it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Saved plans only | Migration + pgTAP fixtures for saved/unsaved/too-late plans | Missing a case where the plan's own earlier days count |
| 2. Smoke, README, roadmap | Smoke restructured around a saved history week; docs match | Smoke ordering: "Next week" shows the latest future plan |

**Prerequisites:** local Supabase stack; preview on :4322 for smoke (dev stays on :4321).
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- Production must get `npx supabase db push` after CI is green and before merge, or the Worker keeps the old rule.
- Behavior changes for existing users immediately: history from unsaved plans stops producing notes.

## Success Criteria (Summary)

- A never-saved or too-late-to-edit week gives no notes; saving it makes it count.
- pgTAP, lint, type check, build and smoke pass.
- README describes the new rule and its walkthrough works.
