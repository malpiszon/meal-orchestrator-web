# Collapse Fully Rated Days — Plan Brief

> Full plan: `context/changes/collapse-fully-rated-days/plan.md`

## What & Why

On the dashboard's "This week", a day whose chosen meals all have a rating collapses to one line that can be opened again. By Friday the user reaches the meals still to rate without scrolling past four finished days. Roadmap S-13 (MS-13), issue #169.

## Starting Point

`WeekPlan.astro` renders every day of a week as an open card, for both "This week" and `/history/<id>`. Each chosen meal already carries its stored rating, and `MealSlot.astro` already uses a native `<details>` for "Other options".

## Desired End State

On "This week", a fully rated day shows a single line: the day, a check icon and "All rated". Tapping it, or Enter/Space on it, opens the day with working rating faces. Days with an unrated meal and days still to come stay open. History is unchanged.

## Key Decisions Made

| Decision             | Choice                                             | Why (1 sentence)                                                                                           |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| When a day collapses | On the next page load, decided at server render    | No JavaScript needed, and the day doesn't vanish under the user's finger right after the last tap.         |
| Collapsed line       | Day label + small check icon + "All rated"         | Says why the day is folded; the icon is distinct from the rating faces (user's choice).                    |
| Mechanism            | Native `<details>`/`<summary>` in `WeekPlan.astro` | Matches the "Other options" pattern; keyboard and screen-reader support come with the element.             |
| Scope switch         | Opt-in `collapseRatedDays` prop, dashboard only    | `WeekPlan` is shared with `/history/<id>`, which stays unchanged (roadmap decision).                       |
| "Fully rated"        | Every chosen meal of the day has a stored rating   | Only chosen meals can be rated; days to come are never fully rated.                                        |
| Testing              | Unit tests for the rule + a new Playwright spec    | Covers the roadmap risk (rate, change, clear inside a reopened day) without touching the critical journey. |

## Scope

**In scope:**

- `isDayFullyRated` helper with unit tests
- Collapsed day rendering behind an opt-in prop, turned on for "This week"
- `docs/api.md` and `docs/testing.md` updates
- New e2e spec `tests/e2e/rated-days.spec.ts`

**Out of scope:**

- Collapsing on `/history/<id>` or "Next week"
- Collapsing right after the last rating on the open page
- Faces or meal names on the collapsed line
- Remembering opened/closed days across reloads
- Any API, database or rating-island change

## Architecture / Approach

Server-side only. `dashboard.astro` passes `collapseRatedDays` to `WeekPlan.astro`. For each day, `isDayFullyRated` checks the chosen meals' ratings, and a fully rated day wraps its card body in a closed `<details>` whose `<summary>` keeps the `<h3>` day heading and adds the check icon and "All rated". The `MealRating` islands inside are unchanged and hydrate when the day is opened and visible.

## Phases at a Glance

| Phase                                    | What it delivers                                                  | Key risk                                                          |
| ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Rule and collapsed day on "This week" | Helper and tests, collapsed rendering, dashboard switch, api docs | A heading inside `<summary>` may not be exposed to assistive tech |
| 2. Browser test for collapsed days       | `rated-days.spec.ts` and testing docs                             | Day-of-week independence of the spec                              |

**Prerequisites:** none (S-13 has no blockers); local Supabase for smoke and e2e.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Chromium must expose the `<h3>` inside `<summary>` as a heading. The e2e spec asserts this; the fallback is an accessible name for the summary that starts with the weekday.
- Assumes this week's Monday is always rateable, which holds because the window is today-7 … today.

## Success Criteria (Summary)

- On a Friday, the user's finished days are single "All rated" lines and the first meal still to rate is near the top.
- A collapsed day opens by tap or keyboard, and rating, changing and clearing still work inside it.
- `/history/<id>` looks exactly as before.
