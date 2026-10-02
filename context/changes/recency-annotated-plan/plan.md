# Recency-annotated plan Implementation Plan

## Overview

S-02, the roadmap's north star. Every option in the upcoming plan that was planned before gets a note with the exact gap to its most recent earlier planned date, e.g. "In your plan 11 days earlier (Thu 1 Oct)". The dashboard gets "This week" / "Next week" tabs, so the in-progress week stays visible from its Monday on. Older weeks become history implicitly (FR-011): no state change, no scheduled job.

## Current State Analysis

S-01 (`context/archive/2026-09-30-mo-weekly-delivery/`) stores one `weekly_plans` row per user and week, plus every menu option as a `plan_meal_options` row with `provider_meal_id`, `meal_date` and `is_recommended`. The dashboard loads only the latest plan with `week_start > today` (Europe/Warsaw). From a plan's Monday until MO's next delivery, it shows "No upcoming plan yet". Nothing reads past plans.

### Key Discoveries:

- Meal identity is settled by the S-01 contract: mo-web keys meals **only** by (`provider`, `provider_meal_id`); names are display text and can change between weeks (`context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md:83-84`).
- The index `plan_meal_options (user_id, provider_meal_id, meal_date)` was created for this lookup (`supabase/migrations/20261001120000_weekly_plans.sql:34`). `provider` lives only on `weekly_plans`.
- RLS allows `authenticated` to select its own rows in both tables (`20261001120000_weekly_plans.sql:39-49`), so a `security invoker` SQL function called through the user's cookie client is isolated per user for free.
- `getUpcomingPlan` (`src/lib/services/plans.ts:10`) uses `gt("week_start", today)` with `today` from `todayInWarsaw` (`src/lib/plans.ts:24`). The in-progress week needs the mirror query.
- `infrastructure.md:63,94`: the free plan allows 10 ms CPU per Worker invocation, so annotations must be computed in Postgres (view or RPC), not in the Worker.
- `WeekPlan.astro` hard-codes the "Upcoming week" eyebrow and `id="week-heading"`, which would collide when two weeks render on one page.
- No shadcn `tabs` component yet; `radix-ui` is already a dependency (`package.json:31`), and React islands are enabled (`astro.config.mjs:15`).
- The smoke script moves the sample delivery to the first Monday ≥ 7 days ahead (`scripts/smoke.mjs:63-80`) and asserts on dashboard HTML. Inactive tab content must therefore be present in the SSR HTML.

## Desired End State

- A signed-in user with both an in-progress and an upcoming plan sees two tabs, "This week" and "Next week". "Next week" is open by default.
- With only an in-progress plan, "This week" is open, and "Next week" shows the existing "No upcoming plan yet" card. With neither, the waiting state shows as today.
- In the upcoming plan, the recommended meal and every option under "Other options" carry `In your plan N days earlier (Ddd D Mmm)` when the same (`provider`, `provider_meal_id`) was a **planned** meal on a strictly earlier date anywhere in the user's history. Options without one carry no note. The in-progress week shows no notes.
- Verify with `npm test`, `npm run lint`, `astro check`, the build and `npm run smoke`. The smoke delivers the current week and the upcoming week from the same sample, then checks the "This week" content and a recency note.

## What We're NOT Doing

- No "history" status, flag or scheduled job: a plan is history because a newer week exists (FR-011).
- No history list/browsing UI (S-07), no ratings in the note (S-08).
- No swap/save; until S-03 exists, "planned" means `is_recommended`. S-03 must switch `get_plan_recency`'s "planned" predicate to the user's saved choice (record this in S-03's plan).
- No notes on the in-progress week's meals.
- No weeks/months rounding: the note always uses days plus the date.
- No change to the delivery endpoint, payload or MO contract.
- Two future weeks delivered at once: "Next week" keeps S-01's choice (latest `week_start > today`); no tab for the week in between.

## Implementation Approach

Postgres does the matching: one `security invoker` function returns, for each option of one plan, the latest earlier planned date of the same meal. The Worker makes one extra RPC and formats strings only. The dashboard loads the current plan and the upcoming plan, then the upcoming plan's recency, and renders both weeks with the existing Astro components inside a small React tabs island.

**Term definitions** (decided in planning; tests pin them):

- **Same meal**: equal `weekly_plans.provider` and `plan_meal_options.provider_meal_id`, same user.
- **Planned occurrence**: a `plan_meal_options` row with `is_recommended = true`. An option that was only offered does not count.
- **Earlier**: `meal_date` strictly before the annotated option's `meal_date`, in any plan, including the in-progress week, dates still ahead of today, and earlier days of the same upcoming plan. The same date in another slot does not count.
- **Most recent**: the maximum such `meal_date`.
- **Note text**: `In your plan {N} day(s) earlier ({weekday short} {day} {month short}[ {year}])`, with N = annotated `meal_date` − earlier `meal_date` in calendar days. "1 day" is singular. The year is appended only when it differs from the annotated meal's year. Example: `In your plan 11 days earlier (Thu 1 Oct)`.
- **This week**: the user's latest plan with `week_start <= today` and `week_start > today − 7 days` (Warsaw dates), so a Mon–Fri plan stays visible on Saturday and Sunday.

## Critical Implementation Details

- **SSR of both tabs.** Radix `TabsContent` unmounts inactive panels by default. Use `forceMount` and hide inactive panels (`data-[state=inactive]:hidden`), so both weeks are in the server HTML. The smoke asserts on that HTML, and the page stays readable before hydration.
- **Astro → React slots.** `WeekPlan` is an Astro component, so the dashboard passes each week as a named slot to the island (`<PlanTabs client:load><WeekPlan slot="current" …/></PlanTabs>`). Astro hands named slots to React as props of static HTML. The island owns only the tab state.
- **Deploy order.** The dashboard calls the new RPC, so `npx supabase db push` to production must run after this PR's CI is green and before merge, as in README's S-01 procedure.

## Phase 1: Recency data layer

### Overview

The SQL function, service functions and pure formatting, all unit-testable without UI.

### Changes Required:

#### 1. Recency function migration

**File**: `supabase/migrations/20261002190000_plan_recency.sql`

**Intent**: Return each option's most recent earlier planned date for one plan, computed in Postgres so the Worker stays within its CPU budget and RLS keeps users isolated.

**Contract**: `public.get_plan_recency(p_plan_id uuid) returns table (option_id uuid, last_planned_on date)`, `language sql stable security invoker set search_path = ''`. One row per option of `p_plan_id` that has an earlier planned occurrence (term definitions above): a join of `plan_meal_options h` to `weekly_plans hp` on matching `user_id`, `provider_meal_id`, `hp.provider = <plan's provider>`, `h.is_recommended`, `h.meal_date < o.meal_date`, `max(h.meal_date)`. `revoke execute … from public, anon`; `grant execute … to authenticated`. Header comment states the "planned = is_recommended until S-03" rule.

#### 2. Plan services

**File**: `src/lib/services/plans.ts`

**Intent**: Add the in-progress week query and the recency RPC next to `getUpcomingPlan`, with the same error and defence-in-depth conventions.

**Contract**: `getCurrentPlan(supabase, userId, today): Promise<WeeklyPlan | null>`: same select as `getUpcomingPlan`, `lte("week_start", today)`, `gt("week_start", addDays(today, -7))`, latest first, `maybeSingle`. `getPlanRecency(supabase, planId): Promise<Map<string, string>>` (option id → `YYYY-MM-DD`). Both throw `Error` with code + message on query error, with no user data. The date arithmetic for `today − 7` is a pure helper in `src/lib/plans.ts` (e.g. `addDays(isoDate, n)`).

#### 3. Recency text

**File**: `src/lib/plans.ts`, `src/lib/plans.test.ts`

**Intent**: A pure formatter for the note, tested at its boundaries.

**Contract**: `formatRecency(mealDate: string, lastPlannedOn: string): string` producing the note text defined above, using UTC-midnight calendar dates like `formatDayLabel`. Short weekday/month come from a hand-built or `en-GB` UTC formatter, checked for identical output under Node (the build uses workerd; see `formatWeekRange`'s note on ICU differences).

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- Unit tests pass, including `formatRecency` (1 day singular, 11 days, cross-month, cross-year with year shown) and `addDays` across month/year ends: `npm test`
- Lint and type checks pass: `npm run lint` and `npx astro check`

#### Manual Verification:

- In local Studio SQL, as an authenticated user with two delivered weeks: `get_plan_recency(<upcoming plan>)` returns the expected dates. A non-recommended earlier option yields no row, and another user's plans are invisible.
- `anon` cannot execute `get_plan_recency`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Dashboard tabs and recency notes

### Overview

The user-visible part: the two-week tabbed dashboard and the notes on upcoming options.

### Changes Required:

#### 1. Tabs component

**File**: `src/components/ui/tabs.tsx` (via `npx shadcn@latest add tabs`), `src/components/plan/PlanTabs.tsx`

**Intent**: A minimal island that switches between the two server-rendered weeks.

**Contract**: `PlanTabs` props: `defaultTab: "current" | "upcoming"`, named-slot props `current` and `upcoming` (ReactNode). Triggers are labelled "This week" and "Next week". Both panels use `forceMount` and are hidden when inactive. No `"use client"`, and styling only through tokens/variants.

#### 2. Week and meal components

**File**: `src/components/plan/WeekPlan.astro`, `src/components/plan/MealSlot.astro`

**Intent**: Make `WeekPlan` reusable for both weeks, and show the note under each annotated option.

**Contract**: `WeekPlan` props gain `label` (e.g. "This week" / "Next week") and `recency?: Map<string, string>`. The heading id is derived from the plan id, so two weeks on one page don't collide. `MealSlot` receives the map and renders `formatRecency(option.meal_date, date)` in `text-muted-foreground` text under the recommended meal and under each other option. It renders nothing when the option has no entry.

#### 3. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Load the current and upcoming plans, plus the upcoming plan's recency, then render tabs or the waiting state.

**Contract**: The current and upcoming plan queries run in parallel; `getPlanRecency` runs only when an upcoming plan exists. Any failure keeps the existing "Couldn't load your plan" card and `console.error` with code and message only. Neither plan → the existing waiting card, without tabs. Otherwise `PlanTabs` opens on `upcoming` when present, else `current`. A missing upcoming plan renders the existing "No upcoming plan yet" card inside the "Next week" tab, and a missing current plan renders a short "Nothing planned for this week" card.

### Success Criteria:

#### Automated Verification:

- Lint, type checks, unit tests and build pass: `npm run lint`, `npx astro check`, `npm test`, `npm run build`
- Existing smoke still passes against the preview on :4322: `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… npm run smoke`

#### Manual Verification:

- With the README dev walkthrough, deliver the sample for the current week and the next week: "Next week" opens by default, repeat meals (recommended and other options) show `In your plan 7 days earlier (…)`, and "This week" shows the current plan without notes
- With only the current week delivered, "This week" opens, and "Next week" shows "No upcoming plan yet"
- Tabs work by keyboard, and both light and dark mode look right on a phone-width viewport

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Smoke and docs

### Overview

Guard the north-star flow in CI and document the new function's production step.

### Changes Required:

#### 1. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Prove history and recency end to end on every CI run.

**Contract**: `loadDelivery` accepts a target Monday. Before the existing upcoming delivery, the smoke user receives the sample moved to the **current** week's Monday (Warsaw). Then: the dashboard contains "This week" plus a meal name of the current week. After the upcoming delivery, the dashboard contains `In your plan N days earlier (` for a recommended meal, where N is computed from the two Mondays. The existing steps (waiting state, 401, provisioning, re-delivery rename) keep passing. The "No upcoming plan yet" step runs before any delivery, as today.

#### 2. Docs

**File**: `README.md`

**Intent**: Document the dashboard's tabs/notes in the dev walkthrough and the migration push before merge.

**Contract**: The README walkthrough adds the step "deliver a second week to see recency notes". The production setup section notes that every new migration (here `get_plan_recency`) is pushed with `npx supabase db push` after CI is green and before merge. The smoke section lists the new checks.

### Success Criteria:

#### Automated Verification:

- Smoke passes locally against the preview on :4322: `npm run build && npm run preview -- --port 4322`, then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… npm run smoke`
- CI `ci` and `smoke` jobs pass on the PR

#### Manual Verification:

- After CI is green and before merge: `npx supabase db push` to production, and the post-deploy smoke stays green after merge
- README walkthrough followed once from scratch produces the documented notes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `formatRecency`: 1 day (singular), 7 and 11 days, across a month boundary, across a year boundary (year appended), same year (no year).
- `addDays`: month end, year end, leap day.

### Integration Tests:

- Smoke: current-week delivery → "This week" content; upcoming delivery → recency note with N derived from the two Mondays; existing S-01 steps unchanged.

### Manual Testing Steps:

1. Deliver the current week and the next week for a dev user and sign in. "Next week" is open, and notes read `In your plan 7 days earlier (Mon …)` for repeats.
2. Change one earlier-week meal so it was only offered (not recommended) and re-deliver that week. The matching upcoming option loses its note.
3. Switch to "This week": no notes, and the current plan is shown.
4. In SQL as another user, `get_plan_recency(<first user's plan>)` returns no rows.

## Performance Considerations

One extra RPC per dashboard request: an index scan per option (≤ ~90 options) on `(user_id, provider_meal_id, meal_date)`. The Worker only formats ≤ ~90 strings, which keeps the request well within the 10 ms CPU limit. Watch CPU time in Workers Logs after deploy (infrastructure risk register).

## Migration Notes

Additive: one new function, no table changes, no backfill. Rollback: deploy the previous Worker. The unused function can stay.

## References

- Roadmap: `context/foundation/roadmap.md` § S-02; issue [#6](https://github.com/malpiszon/meal-orchestrator-web/issues/6); phase sub-issues #33 (Phase 1), #34 (Phase 2), #35 (Phase 3)
- PRD: FR-008, FR-011, US-01, US-06 (`context/foundation/prd.md`)
- S-01 plan and contract: `context/archive/2026-09-30-mo-weekly-delivery/plan.md`, `mo-delivery-contract.md`
- Schema: `supabase/migrations/20261001120000_weekly_plans.sql`
- Patterns: `src/lib/services/plans.ts:10`, `src/lib/plans.ts:24`, `scripts/smoke.mjs:63`
- CPU constraint: `context/foundation/infrastructure.md:63,94`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recency data layer

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset` — 804864a
- [x] 1.2 Unit tests pass, including `formatRecency` and `addDays` boundaries: `npm test` — 804864a
- [x] 1.3 Lint and type checks pass: `npm run lint` and `npx astro check` — 804864a

#### Manual

- [x] 1.4 `get_plan_recency` returns expected dates; offered-only options and other users' plans are excluded — 804864a
- [x] 1.5 `anon` cannot execute `get_plan_recency` — 804864a

### Phase 2: Dashboard tabs and recency notes

#### Automated

- [x] 2.1 Lint, type checks, unit tests and build pass — 71ac804
- [x] 2.2 Existing smoke still passes against the preview on :4322 — 71ac804

#### Manual

- [x] 2.3 Two delivered weeks: "Next week" default with recency notes on all options; "This week" without notes — 71ac804
- [x] 2.4 Only current week delivered: "This week" opens, "Next week" shows "No upcoming plan yet" — 71ac804
- [x] 2.5 Tabs keyboard-accessible; light/dark and phone width look right — 71ac804

### Phase 3: Smoke and docs

#### Automated

- [ ] 3.1 Smoke passes locally against the preview on :4322
- [ ] 3.2 CI `ci` and `smoke` jobs pass on the PR

#### Manual

- [ ] 3.3 Production `npx supabase db push` before merge; post-deploy smoke green after merge
- [ ] 3.4 README walkthrough followed from scratch produces the documented notes
