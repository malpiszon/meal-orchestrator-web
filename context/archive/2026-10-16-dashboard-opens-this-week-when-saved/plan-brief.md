# Dashboard Opens "This week" Once Next Week Is Saved — Plan Brief

> Full plan: `context/changes/dashboard-opens-this-week-when-saved/plan.md`

## What & Why

S-12 (#168, MS-12): in a typical week MO delivers next week on Tuesday, the user chooses their meals, and from Wednesday they come back to rate what they ate, but still land on "Next week". Once next week is saved, choosing is done, so the dashboard should open on "This week".

## Starting Point

`src/pages/dashboard.astro:129` opens "Next week" whenever an upcoming plan exists, saved or not. Both plans, including `saved_at`, are already loaded; the tabs island takes the default as Radix `defaultValue`, so it only affects the initial render.

## Desired End State

`/dashboard` opens "This week" when next week is saved and this week has a plan; "Next week" when next week is unsaved, or saved but this week has no plan; "This week" when there is no upcoming plan. The open page never switches tabs after a save. The rule is unit-tested, checked in the e2e journey and documented in `docs/api.md`.

## Key Decisions Made

| Decision                         | Choice                                                    | Why (1 sentence)                                                     | Source  |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | ------- |
| Switch right after a save?       | No, only the next time the dashboard opens                | Every swap saves, so the user must be able to keep swapping          | #168    |
| Re-delivered saved week          | No special case; it stays saved, so it opens "This week"  | The tab follows the saved state alone                                | #168    |
| Saved next week, no current plan | Opens "Next week"                                         | "This week" would only show that there is nothing this week          | Roadmap |
| Where the rule lives             | Pure `defaultPlanTab` helper in `src/lib/plans.ts`        | Every case becomes a cheap unit test; matches the plan helpers there | Plan    |
| Test coverage                    | Unit cases + e2e default-tab assertions (no smoke change) | Unit covers all branches, e2e proves the page wires it in            | Plan    |

## Scope

**In scope:**

- `defaultPlanTab` helper and its unit tests; `PlanTab` type moved to `src/types.ts`
- Wiring in `dashboard.astro`
- `docs/api.md` rule, `docs/dev-walkthrough.md` steps 4–5
- E2E: default-tab assertions in the journey, shared `openTab` helper, seed spec selects "Next week" itself

**Out of scope:**

- Switching tabs on save, remembering the last tab, a "saved" marker on the tab
- Any migration, query, API or `/history` change; smoke assertions

## Architecture / Approach

The page passes `defaultPlanTab(currentPlan, upcomingPlan)` to the existing `PlanTabs` island. The result is server-rendered (`aria-selected`), so the e2e journey asserts it without a click: "Next week" after the invitation (unsaved), "This week" after signing in again (saved by the keep and swap steps).

## Phases at a Glance

| Phase               | What it delivers                                           | Key risk                                                   |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Default-tab rule | Helper + unit tests, dashboard wiring, docs                | Missing the "saved but no current plan" case               |
| 2. E2E coverage     | Journey asserts both defaults; seed independent of default | Seed user on the shared local stack with a saved next week |

**Prerequisites:** none (no migration; shared local Supabase is fine). Previews and e2e run on port 4325.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- A user who wants to keep editing a saved week needs one extra tap; accepted on the roadmap because saving signals that choosing is done.
- Assumes `saved_at` stays non-null after a re-delivery of a saved week (documented in `docs/api.md` § Re-delivery).

## Success Criteria (Summary)

- From Wednesday, a user who saved next week opens the dashboard straight onto "This week" to rate.
- A user with an unsaved next week still opens on "Next week" to choose.
- Unit and e2e tests fail if the rule regresses.
