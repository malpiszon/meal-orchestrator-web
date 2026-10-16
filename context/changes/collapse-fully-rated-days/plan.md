# Collapse Fully Rated Days Implementation Plan

## Overview

On the dashboard's "This week" tab, a day whose chosen meals all have a rating renders collapsed to a single line (the day, a small check icon and "All rated") that the user can open again. By Friday the user reaches the meals still to rate without scrolling past the whole week. Roadmap item S-13 (MS-13), issue #169.

## Current State Analysis

- `src/components/plan/WeekPlan.astro:31-44` renders every day as a shadcn `Card` (heading `<h3>` with `formatDayLabel`, then one `MealSlot` per slot). The same component serves the dashboard's "This week" (`src/pages/dashboard.astro:139`) and `/history/<id>` (`src/pages/history/[id].astro:62`).
- Each chosen meal carries its stored rating as `chosen.meal_ratings?.rating` (`src/types.ts:55-56`, read in `src/components/plan/MealSlot.astro:26`), so whether a day is fully rated is known at server render with no new query.
- The faces are one `MealRating` island per meal (`client:visible`, `MealSlot.astro:55`); nothing shares state across a day's meals.
- The rating window is today-7 … today (`src/lib/ratings.ts:40`). Every past day of the current week is inside it, and days still to come have no ratings, so on "This week" a day is never "unrated and locked".
- `MealSlot.astro:58` already uses a native `<details>`/`<summary>` for "Other options": the established no-JS disclosure pattern.
- Icons in `.astro` files are inlined lucide SVGs (`src/components/plan/RecencyNote.astro:11-26`), not `lucide-react`, to avoid a React SSR pass.

## Desired End State

- On "This week", a day whose every chosen meal has a stored rating renders as a closed disclosure: the day label, a check icon and "All rated". Tapping it, or Enter/Space on it, opens the day with its meals and working rating faces; tapping again closes it.
- Days with an unrated chosen meal and days still to come render open, exactly as today.
- The decision is made when the page renders: a day whose last meal is rated on the open page stays open until the page is loaded again.
- `/history/<id>` renders every day open, as today.
- Verified by unit tests for the rule, a Playwright spec for the browser behaviour, and a manual check in light/dark mode at phone width.

### Key Discoveries:

- `WeekPlan.astro` is shared with history, so collapsing must be an opt-in prop, off by default (`dashboard.astro:139`, `history/[id].astro:62`).
- The sample delivery (`scripts/fixtures/mo-delivery.sample.json`) has 2 meals per day, Monday to Friday, so "fully rated Monday" in e2e means rating 2 meals.
- The critical journey rates only Monday's first meal (`tests/e2e/critical-journey.spec.ts:89-126`), so Monday stays open there and that spec needs no change; its `dayCard` helper finds a day by `[data-slot="card"]` plus a heading, which the collapsed card must keep supporting.
- `<details>` content is in the server HTML even when closed, so the smoke test's HTML parsing of `data-rating-option-id` (`scripts/smoke.mjs:121-129`) is unaffected.

## What We're NOT Doing

- No collapse on `/history/<id>` (decided in the roadmap, 2026-10-15).
- No collapsing on the open page right after the last rating (decided: only on the next page open).
- No rating faces or meal names on the collapsed line (decided: day, check icon, "All rated").
- No remembering which days the user opened or closed across reloads.
- No collapsing on "Next week" and no change to `MealRating`, `useMealRating`, `/api/ratings` or the database.
- No change to `critical-journey.spec.ts`.

## Implementation Approach

A pure helper decides "fully rated" for a `PlanDay`. `WeekPlan.astro` gets an opt-in prop. When it is set, a fully rated day renders its card body inside a closed native `<details>` whose `<summary>` holds the day heading, the check icon and "All rated". Other days render exactly as now. No new island and no client JavaScript; the browser handles keyboard and screen-reader semantics of `<details>`.

## Critical Implementation Details

- **User experience spec**: the `<summary>` keeps the day's `<h3>` so headings navigation and the e2e `dayCard` helper (`getByRole("heading")` inside `[data-slot="card"]`) still find the day. Check in the e2e spec that the heading is exposed inside the summary in Chromium. If it is not, keep the visible text and give the summary an accessible name that starts with the weekday. The summary needs a visible focus style (token-based ring, as shadcn buttons use) and the default disclosure marker replaced or kept consistently with "Other options".

## Phase 1: Rule and collapsed day on "This week"

### Overview

The rule, its unit tests, the collapsed rendering behind an opt-in prop, the dashboard turning it on, and the docs.

### Changes Required:

#### 1. "Fully rated" rule

**File**: `src/lib/ratings.ts`, `src/lib/ratings.test.ts`

**Intent**: One pure function says whether every chosen meal of a day has a stored rating, so the rule lives in unit-tested code and not in the template.

**Contract**: `isDayFullyRated(day: PlanDay): boolean` — `true` when the day has at least one slot and every `slot.chosen.meal_ratings` is non-null; `false` for a day with no slots. Only the chosen option counts; ratings on other options are ignored. Tests: all chosen rated → true; one chosen unrated → false; a non-chosen option rated but chosen unrated → false; no slots → false; ratings of 1 (lowest) count as rated.

#### 2. Collapsed day rendering

**File**: `src/components/plan/WeekPlan.astro`

**Intent**: Add an opt-in prop; when on, a fully rated day renders as a closed `<details>` card showing the day label, an inlined lucide check icon (e.g. `circle-check`, `aria-hidden`) and "All rated" (muted text), and opens to the same `MealSlot` list as today. Other days, and every day when the prop is off, render unchanged.

**Contract**: new prop `collapseRatedDays?: boolean` (default `false`, JSDoc: "Collapse days whose chosen meals are all rated; 'This week' only"). The collapsed card keeps `data-slot="card"` (it is still a `Card`) and the `<h3>` day heading inside the `<summary>`. Styling uses tokens and `cn()`/`class:list` only; the collapsed card is a single line (no empty content padding when closed).

#### 3. Dashboard turns it on

**File**: `src/pages/dashboard.astro`

**Intent**: Pass `collapseRatedDays` to the "This week" `WeekPlan`; `/history/<id>` keeps the default.

**Contract**: `<WeekPlan plan={currentPlan} label="This week" today={today} collapseRatedDays />`.

#### 4. Docs

**File**: `docs/api.md`

**Intent**: Describe the rule where "This week" is described: in the routes table row for `/dashboard` (briefly) and in § Ratings (a bullet: on "This week", a day whose chosen meals all have a rating opens collapsed to "All rated" and can be opened again; it collapses the next time the page is loaded, not right after the last rating; `/history/<id>` shows every day open). Update `docs/dev-walkthrough.md` only if its ratings step describes the "This week" layout in a way this contradicts.

**Contract**: `docs/api.md` § Ratings and the `/dashboard` row.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new `isDayFullyRated` cases: `npm test`
- Lint and type-checked rules pass: `npm run lint`
- Production build succeeds: `npm run build`
- Smoke test passes against a preview on :4322: `npm run smoke`

#### Manual Verification:

- On "This week" with a day whose meals are all rated, that day shows one line with the day, the check icon and "All rated"; days with an unrated meal and days to come are open
- The collapsed day opens and closes by mouse and by keyboard (Tab to it, Enter/Space), with a visible focus ring
- Inside an opened day, a rating can be changed and cleared, and the faces respond
- Rating the last meal of a day leaves it open until reload; after reload it is collapsed
- `/history/<id>` of a past week with fully rated days shows every day open
- Collapsed line looks right in light and dark mode at phone width (no horizontal scroll)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Browser test for collapsed days

### Overview

A new Playwright spec covering the roadmap risk: rating still saves, changes and clears inside a reopened day, and the collapsed line is a real keyboard control.

### Changes Required:

#### 1. E2E spec

**File**: `tests/e2e/rated-days.spec.ts`

**Intent**: One new user per run (like the critical journey, so earlier runs' ratings can't leave Monday collapsed), created by `deliverWeek` for this week (`thisMonday(today)`) plus `ensureUserWithPassword`, signed in with `signIn` in a browser without the stored session. Steps: open "This week"; rate both of Monday's chosen meals; reload; Monday shows "All rated" and its faces are hidden, while Tuesday (or the next day) is open; focus Monday's summary and press Enter, the faces show; change one rating and clear the other, each pressed state updates; reload, Monday is open (it is no longer fully rated). Uses `openTab` and the existing support helpers; the day is located by its heading like the critical journey's `dayCard`.

**Contract**: new file under `tests/e2e/`, runs in the default Chromium project, passes on any weekday and on a stack where the user doesn't exist yet, and again right away. Assert the summary heading is exposed (see Critical Implementation Details).

#### 2. Testing docs

**File**: `docs/testing.md`

**Intent**: § E2E lists the specs ("Two specs:"); add this one with what it asserts and update the count.

**Contract**: `docs/testing.md` § E2E.

### Success Criteria:

#### Automated Verification:

- The new spec and the existing ones pass locally (nothing stale on `E2E_PORT` first): `npm run test:e2e`
- The new spec passes twice in a row without resetting the stack
- Lint passes: `npm run lint`

#### Manual Verification:

- CI's e2e job is green on the PR

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isDayFullyRated`: all rated, one unrated, only a non-chosen option rated, no slots, lowest rating counts.

### Integration Tests:

- `tests/e2e/rated-days.spec.ts`: collapse after reload, keyboard open, change and clear inside the opened day, reopened after a clear.
- Existing smoke and critical journey stay green unchanged.

### Manual Testing Steps:

1. Follow `docs/dev-walkthrough.md` to deliver this week, sign in, rate every meal of one past day, reload: the day is one "All rated" line.
2. Open it with the keyboard, change a rating, clear one, reload: the day is open again.
3. Open a past week in History: all days open.
4. Check light/dark mode and a phone-width viewport.

## Performance Considerations

None: no new query, no new island; the rule runs over at most 7 days at render.

## Migration Notes

None: no schema or data change. Deploy is a normal merge to `master`.

## References

- Roadmap: `context/foundation/roadmap.md` § S-13; issue #169
- Phase sub-issues: #177 (Phase 1), #178 (Phase 2, blocked by #177)
- Similar disclosure: `src/components/plan/MealSlot.astro:58`
- Inlined icon pattern: `src/components/plan/RecencyNote.astro:11`
- E2E helpers: `tests/e2e/support/{deliveries,users,auth,tabs}.ts`, `tests/e2e/critical-journey.spec.ts:20`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rule and collapsed day on "This week"

#### Automated

- [x] 1.1 Unit tests pass, including the new `isDayFullyRated` cases: `npm test` — e04d177
- [x] 1.2 Lint and type-checked rules pass: `npm run lint` — e04d177
- [x] 1.3 Production build succeeds: `npm run build` — e04d177
- [x] 1.4 Smoke test passes against a preview on :4322: `npm run smoke` — e04d177

#### Manual

- [x] 1.5 On "This week" with a day whose meals are all rated, that day shows one line with the day, the check icon and "All rated"; days with an unrated meal and days to come are open — e04d177
- [x] 1.6 The collapsed day opens and closes by mouse and by keyboard (Tab to it, Enter/Space), with a visible focus ring — e04d177
- [x] 1.7 Inside an opened day, a rating can be changed and cleared, and the faces respond — e04d177
- [x] 1.8 Rating the last meal of a day leaves it open until reload; after reload it is collapsed — e04d177
- [x] 1.9 `/history/<id>` of a past week with fully rated days shows every day open — e04d177
- [x] 1.10 Collapsed line looks right in light and dark mode at phone width (no horizontal scroll) — e04d177

### Phase 2: Browser test for collapsed days

#### Automated

- [x] 2.1 The new spec and the existing ones pass locally (nothing stale on `E2E_PORT` first): `npm run test:e2e`
- [x] 2.2 The new spec passes twice in a row without resetting the stack
- [x] 2.3 Lint passes: `npm run lint`

#### Manual

- [ ] 2.4 CI's e2e job is green on the PR
