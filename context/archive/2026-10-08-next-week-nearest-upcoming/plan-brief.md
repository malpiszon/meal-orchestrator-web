# "Next week" Shows the Nearest Upcoming Week — Plan Brief

> Full plan: `context/changes/next-week-nearest-upcoming/plan.md`
> Frame brief: `context/changes/next-week-nearest-upcoming/frame.md`

## What & Why

"Next week" must be the nearest future week, so that the week with the earliest edit deadline is always the one
the user can see, swap and save. Later future weeks are stored but not shown until they become the nearest.
Today, with two future weeks delivered, the nearer one is unreachable and turns into "This week" unsaved.

## Starting Point

`getUpcomingPlan` picks the latest week with `week_start > today` (S-01's tie-break, kept by S-02's review).
Nothing else (cut-off, recency, ratings, history, SQL) depends on that choice. The smoke and README walkthrough
step 6 rely on a later week replacing the saved upcoming one to show a cross-week recency note.

## Desired End State

With W+1 and W+2 delivered, "Next week" shows W+1 and W+2 appears nowhere until W+1 starts. The smoke checks
that and still checks a recency note rendering after a real save. README describes the rule.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which future week is "Next week" | Nearest (`week_start` ascending) | Earliest edit deadline must be reachable | Frame |
| Second future week | Hidden until the nearer one starts; no extra tab | User doesn't need to see it early | Frame |
| Far-ahead deliveries | Still accepted and stored | MO may legitimately deliver earlier | Frame |
| Smoke recency check | Same-week note: a later day repeats the swapped-to meal | Keeps an end-to-end note after a real save; the clock can't move | Plan |
| Two-future-weeks coverage | Deliver a later week; "Next week" stays on the saved week, later meal absent | Covers the issue's DoD directly | Plan |
| Phasing | One phase | Smoke never red between commits | Plan |

## Scope

**In scope:** query order + JSDoc, unit test for the order, smoke rework (same-week note, two future weeks),
README (rule sentence, walkthrough step 6, smoke description).

**Out of scope:** a view for the second future week, delivery endpoint changes, SQL/migrations, cross-week
recency in the smoke (pgTAP covers it), PRD changes.

## Architecture / Approach

`.order("week_start", { ascending: true })` in `getUpcomingPlan`. The smoke's upcoming-week copy gets a later
day option with the swapped-to meal's `provider_meal_id`; `get_plan_recency` already counts earlier days of a
saved plan, so after the swap that option reads "In your plan 1 day earlier (…".

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Nearest future week, smoke and docs | New rule, unit test, reworked smoke, README | Fixture edit colliding with earlier smoke name checks |

**Prerequisites:** local Supabase running (shared; no migration needed); preview on :4323.
**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- Shared smoke data with the S-09 worktree: re-run a failing step alone before debugging.
- The repeated meal must be a non-recommended variant of `days[1].meals[0]`, so the swap's "checked" and
  re-delivery checks keep finding unique names.

## Success Criteria (Summary)

- Two future weeks: "Next week" shows the nearer one.
- Smoke green on :4323 with both new checks.
- README walkthrough matches the app.
