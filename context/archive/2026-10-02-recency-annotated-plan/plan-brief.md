# Recency-annotated plan — Plan Brief

> Full plan: `context/changes/recency-annotated-plan/plan.md`

## What & Why

S-02 is the north star (FR-008, FR-011, US-01, US-06). MO keeps no memory, so a meal you just had can be recommended again. mo-web now notes, next to each upcoming option, when that meal was last in your plan. It also keeps the in-progress week visible, so older weeks become history without anyone doing anything.

## Starting Point

S-01 stores each delivered week (`weekly_plans`) and every menu option (`plan_meal_options`, keyed by `provider_meal_id`, with an index built for this lookup). The dashboard shows only the upcoming plan. From a plan's Monday until the next delivery, it says "No upcoming plan yet".

## Desired End State

The dashboard has "This week" / "Next week" tabs, with "Next week" open by default when it exists. In the upcoming plan, the recommended meal and every other option carry `In your plan 11 days earlier (Thu 1 Oct)` when the same meal was planned on an earlier date. The in-progress week stays visible all week, weekend included. CI's smoke proves the flow with two deliveries.

## Key Decisions Made

| Decision            | Choice                                                                            | Why (1 sentence)                                                                                 | Source        |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------- |
| Same meal           | Equal `provider` + `provider_meal_id`, never the name                             | The S-01 contract makes this the only meal identity.                                             | S-01 contract |
| What counts         | Only planned meals (`is_recommended`; S-03 switches to the saved choice)          | "Was in your plan" means what you got, not what was merely offered.                              | Plan          |
| Which options       | Recommended meal and all "Other options"                                          | Shows whether a swap candidate is a repeat too.                                                  | Plan          |
| Measured from       | The annotated meal's own date; any strictly earlier date, same week included      | Measures the variety gap, and the note doesn't change from day to day.                            | Plan          |
| Wording             | Always days plus the date, e.g. `11 days earlier (Thu 1 Oct)`; year only if it differs | Exact and easy to place in memory.                                                               | Plan          |
| In-progress week    | Tabs "This week" / "Next week"; no notes on this week                             | Closes the Monday gap with both weeks one click away.                                            | Plan          |
| Where it's computed | `security invoker` SQL function `get_plan_recency`, RLS-bound                     | Free-plan 10 ms CPU limit; RLS isolates users for free.                                          | Infra doc     |
| History             | Implicit: older than the newest week; no flag or job                              | FR-011 says history follows from a newer delivery existing.                                      | PRD           |

## Scope

**In scope:** the recency SQL function, `getCurrentPlan` / `getPlanRecency`, `formatRecency` with unit tests, the tabbed dashboard with notes, smoke checks, and README updates.

**Out of scope:** a history list (S-07), ratings (S-08), swap/save (S-03), notes on the in-progress week, weeks/months rounding, and any change to the delivery endpoint or MO contract.

## Architecture / Approach

Dashboard → (in parallel) `getCurrentPlan` + `getUpcomingPlan` → `get_plan_recency(upcoming.id)` RPC returns (option id → last planned date). Postgres matches on the indexed `(user_id, provider_meal_id, meal_date)`. The Worker only formats strings. Both weeks render server-side with the Astro `WeekPlan`/`MealSlot` inside a small shadcn `Tabs` React island (`forceMount`, so both weeks are in the HTML).

## Phases at a Glance

| Phase                        | What it delivers                                                   | Key risk                                                              |
| ---------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 1. Recency data layer        | SQL function, services, `formatRecency` + tests                    | Getting the "planned" / "strictly earlier" predicates wrong          |
| 2. Dashboard tabs and notes  | Tabbed dashboard with notes on all upcoming options                | Radix unmounting inactive tabs (fixed by `forceMount`), slot wiring  |
| 3. Smoke and docs            | CI-proven two-delivery flow; README walkthrough and deploy step    | Forgetting `db push` before merge breaks the production dashboard    |

**Prerequisites:** S-01 done (it is); a local Supabase stack for development.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- Until S-03 ships, a meal you swapped away still counts as planned. S-03 must update `get_plan_recency`.
- If MO delivers two future weeks, "Next week" shows the later one (S-01's rule); the week in between has no tab.
- The migration must reach production after CI is green and before merge, or the dashboard shows "Couldn't load your plan".

## Success Criteria (Summary)

- After a second weekly delivery, the previous week stays visible under "This week" and repeat meals in "Next week" carry the correct `N days earlier (date)` note.
- Offered-but-not-planned meals and other users' plans never produce a note.
- The CI smoke covers the flow, and the dashboard stays within the Workers CPU budget.
