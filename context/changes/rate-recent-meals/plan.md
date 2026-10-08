# Rate Recent Meals Implementation Plan

## Overview

Users rate the meal in their plan (each slot's chosen option) on a five-face scale, 🤢 Never again · 😕 Meh · 😐 Fine · 🙂 Tasty · 😋 Chef's kiss, from the meal's own day until 7 days after it (S-08, FR-013, US-08, issue #11). The rating appears on later plans: the "Next week" editor shows, next to every option, the user's rating of that meal from the most recent earlier day they rated it, alongside (or without) the recency note.

## Current State Analysis

- Plans live in `weekly_plans` + `plan_meal_options` (`supabase/migrations/20261001120000_weekly_plans.sql`); each slot has exactly one `is_chosen` option (`20261003120000_plan_choices.sql:16-18`). Users have only `select` policies; every write goes through a `security definer` function that checks the owner and a Europe/Warsaw date rule (`choose_plan_option`, `20261003120000_plan_choices.sql:102-160`).
- A week can no longer be re-delivered once it has started (`20261006120000_week_resubmission_rules.sql`), so the option rows of any meal dated today or earlier are stable: a rating can reference `plan_meal_options.id`.
- "This week" (`src/pages/dashboard.astro`) and `/history/<id>` (`src/pages/history/[id].astro`) both render through `WeekPlan.astro` → `MealSlot.astro`, which are static Astro. "Next week" is the React island `UpcomingWeekEditor.tsx`, the only place recency notes are shown.
- The history boundary is `week_start <= today - 7` (`getPastPlans`, `src/lib/services/plans.ts`). The rating window `today-7 … today` therefore spans the current week and the last days of the previous week, which is already in history: a "This week only" UI would make Sunday's meals rateable only on Sunday, contradicting US-08's third acceptance criterion.
- Writes from the browser follow `handlePlanSave` (`src/lib/plan-save.ts`): size cap, JSON parse, zod, cookie session, RPC with `withPgrst303Retry`, error kinds mapped to HTTP codes.
- No `lessons.md` exists.

## Desired End State

- On "This week", each chosen meal dated today or earlier shows five face buttons ("How was it?"); tapping one saves it at once, tapping the selected face again clears it. Meals dated after today show no controls.
- On `/history/<id>` of the previous week, the chosen meals dated `today-7` or later show the same controls; older meals of any past week show their rating read-only ("😋 Chef's kiss") or nothing.
- The "Next week" editor shows "Last rated 😋 Chef's kiss" (wording per Phase 4) on each option whose meal (same provider, same `provider_meal_id`) has a rating on an earlier day; the rating shown is the one from the most recent rated meal day.
- The database refuses any rating outside the window, of a non-chosen option, or of another user's meal, whatever the page sends.

### Key Discoveries:

- Recency join to mirror for "same meal, earlier day": `supabase/migrations/20261007120000_recency_saved_plans_only.sql:16-38` (same `user_id`, `provider_meal_id`, `provider`, `meal_date <` the option's).
- Warsaw-today in SQL: `(now() at time zone 'Europe/Warsaw')::date` (`20261003120000_plan_choices.sql:130`); in TS: `todayInWarsaw` (`src/lib/plans.ts:24`), `addDays` (`src/lib/plans.ts:137`).
- Error-kind mapping pattern: `planWriteErrorKind` / `PlanWriteError` (`src/lib/services/plans.ts:206-224`).
- Optimistic save with one request in flight and revert on error: `usePlanChoices` (`src/components/hooks/usePlanChoices.ts`).
- Annotation styling: `RecencyNote.astro` and the inline recency line in `UpcomingWeekEditor.tsx:104-109`.
- Fixture weeks are Mon–Fri with two meals a day (`scripts/fixtures/mo-delivery.sample.json`); smoke moves the same meals to several weeks, so the same `provider_meal_id`s recur across weeks.

## What We're NOT Doing

- Rating only on the "This week" tab (rejected: breaks the 7-day window across the week boundary).
- Rating non-chosen options ("Other options" stay plain); a user who cooked an alternative can't record it.
- Averages or rating history; only the rating from the most recent rated meal day is shown on later plans.
- Showing ratings of other meals on "This week" or history as annotations (only each meal's own rating appears there).
- Letting ratings feed recency (a rating does not make an unsaved plan count as history).
- Sending ratings to MO (mo-web → MO integration is out of scope).
- Changing the window length (7 days stays, as the PRD's best-guess value).

## Implementation Approach

Database first, as in S-03: the table and both functions own every rule (window, chosen-only, ownership, "latest"), with pgTAP tests, so the UI can trust a 409 and never compute "latest" itself. The UI computes `isRateable` only to decide whether to render controls; the database stays authoritative (a page left open past midnight gets a 409 and locks).

## Critical Implementation Details

- **Window boundaries:** rateable iff `today - 7 <= meal_date <= today` (Europe/Warsaw, both ends inclusive), the same predicate in SQL and in `isRateable`. Example on Wed 14 Oct: Wed 7 Oct ✓, Tue 6 Oct ✗, Wed 14 Oct ✓, Thu 15 Oct ✗.
- **"Latest" means most recent rated meal day:** for an option dated D, take ratings of the same meal on days `< D` and pick the one with the greatest `meal_date`; a later occurrence without a rating does not hide an earlier rating, and re-rating an older occurrence does not override a newer occurrence's rating. Example: 1 Oct rated 😋, 8 Oct rated 🤢, 1 Oct re-rated 😐 on 9 Oct → a 15 Oct option shows 🤢. If 8 Oct had no rating → 😋 (then 😐 after the re-rate).
- **Nested islands:** the rating island renders inside `WeekPlan`, which on the dashboard sits in a slot of the `PlanTabs` React island. Astro supports islands inside framework slots, but verify hydration on the dashboard early in Phase 3; if it fails, render the faces as a single island per week instead.

## Phase 1: Database — ratings table and functions

### Overview

Store ratings with every rule enforced in Postgres, and expose the "latest earlier rating" read.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261008120000_meal_ratings.sql`

**Intent**: Create the ratings table, the write function and the read function, with a header comment stating the rules (as the earlier migrations do).

**Contract**:
- Table `public.meal_ratings`: `option_id uuid primary key references public.plan_meal_options on delete cascade`, `user_id uuid not null`, `rating smallint not null check (rating between 1 and 5)`, `rated_at timestamptz not null default now()`. RLS enabled; one policy `meal_ratings_select_own_authenticated` (select, `authenticated`, `user_id = (select auth.uid())`); `insert, update, delete, truncate` revoked from `anon, authenticated`.
- `public.rate_meal(p_option_id uuid, p_rating smallint) returns smallint` — `security definer`, `set search_path = ''`. Looks up the option joined to its plan with `p.user_id = auth.uid()`; none → `P0002 not_found`. Not `is_chosen`, or `meal_date` outside `today-7 … today` (Warsaw) → `55000 not_rateable`. `p_rating` null → delete the row; otherwise upsert (`rating`, `rated_at = now()`). Returns the stored rating, or null after a clear. A rating outside 1–5 fails the check constraint (`23514`). Execute granted to `authenticated` only.
- `public.get_plan_ratings(p_plan_id uuid) returns table (option_id uuid, rating smallint)` — `security invoker`, `stable`. For each option of the plan, the rating of the same meal (`user_id`, `provider_meal_id`, `weekly_plans.provider` equal) with the greatest `meal_date` strictly before the option's `meal_date`; options without one are absent. Execute granted to `authenticated` only.

#### 2. pgTAP tests

**File**: `supabase/tests/meal_ratings.test.sql`

**Intent**: Pin the rules, following `plan_choices.test.sql`'s setup style (users, deliveries, `set local role authenticated` + `request.jwt.claims`).

**Contract**: Covers: rating today and `today-7` succeeds; `today+1` and `today-8` → `not_rateable`; a non-chosen option → `not_rateable`; another user's option → `not_found`; re-rating updates; null clears; rating 0 or 6 refused; `anon` can't execute either function; `authenticated` can't insert into the table directly and sees only its own rows; `get_plan_ratings` returns the most-recent-rated-meal-day rating per the example in Critical Implementation Details (including the unrated-later-occurrence and re-rate cases), ignores same-day and later occurrences, and ignores another provider's meal.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- Database tests pass: `npx supabase test db`

#### Manual Verification:

- The table, policy and both functions look right in local Studio, with RLS enabled on `meal_ratings`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Rating API and domain helpers

### Overview

The browser's write path and the pure helpers both UIs share.

### Changes Required:

#### 1. Rating domain helpers

**File**: `src/lib/ratings.ts` (+ `src/lib/ratings.test.ts`)

**Intent**: One source for the scale and the window, with no `astro:env` import so Vitest loads it.

**Contract**: `RATING_FACES`: readonly array of `{ value: 1..5, emoji, label }` in order 🤢 Never again, 😕 Meh, 😐 Fine, 🙂 Tasty, 😋 Chef's kiss; `ratingFace(value)`; `isRateable(mealDate, today)` implementing the window predicate. Tests cover both window ends and one day past each.

#### 2. Service functions

**File**: `src/lib/services/ratings.ts`

**Intent**: Call the two RPCs with the user's cookie-session client, retrying PGRST303 via `withPgrst303Retry`, logging code and message only.

**Contract**: `rateMeal(supabase, optionId, rating: number | null): Promise<number | null>` throwing `RatingWriteError` with kind `not_found | not_rateable | failed` (mapping as `planWriteErrorKind`); `getPlanRatings(supabase, planId): Promise<Map<string, number>>` throwing on error.

#### 3. API route

**File**: `src/pages/api/ratings.ts`

**Intent**: `POST` endpoint for the rating island, structured like `handlePlanSave` (config → auth → size cap → JSON → zod → write). `prerender = false`.

**Contract**: Body `{ optionId: uuid, rating: 1..5 | null }` (zod: `z.int().min(1).max(5).nullable()`). Responses: 200 `{ "rating": n | null }`; 400 `invalid_request` + issues; 401 `unauthorized`; 404 `not_found`; 409 `not_rateable`; 413 `payload_too_large` (over 4 KiB); 503 `not_configured`; 500 `save_failed`. Not added to `PROTECTED_ROUTES` (answers 401 itself).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check and build pass: `npx astro check && npm run build`

#### Manual Verification:

- With `npm run dev`, a `curl` with a signed-in session cookie rates this week's Monday meal (200) and an upcoming meal (409 `not_rateable`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Rating on the week views

### Overview

Faces on the chosen meals of "This week" and of the previous week's history page, inside the window; read-only ratings elsewhere.

### Changes Required:

#### 1. Read own ratings with the plan

**File**: `src/lib/services/plans.ts`, `src/types.ts`

**Intent**: Each option carries its own rating, read in the same query as the plan (RLS limits it to the user's rows).

**Contract**: `PLAN_SELECT` embeds `meal_ratings(rating)` inside `plan_meal_options` (one-to-one, since `option_id` is the primary key: PostgREST returns an object or `null`); `PlanMealOption` gains `meal_ratings: { rating: number } | null`. The upcoming editor's props stay without it.

#### 2. Rating island

**File**: `src/components/plan/MealRating.tsx` (+ hook `src/components/hooks/useMealRating.ts` if the state logic is more than a few lines)

**Intent**: "How was it?" plus five face toggle buttons (`aria-pressed`, `aria-label` = label, emoji `aria-hidden`), styled with shadcn `Button` variants (`outline` / selected `default`) and tokens only. Tap saves optimistically through `POST /api/ratings`; tapping the selected face sends `null`; one request in flight; revert on error with a short message (401 signed out, 409 "Rating for this meal has closed." and lock the controls, else "Couldn't save your rating."). The root carries `data-rating-option-id` for the smoke test.

**Contract**: Props `{ optionId: string; initialRating: number | null }`.

#### 3. Wire into MealSlot / WeekPlan and the pages

**Files**: `src/components/plan/MealSlot.astro`, `src/components/plan/WeekPlan.astro`, `src/pages/dashboard.astro`, `src/pages/history/[id].astro`

**Intent**: `WeekPlan` takes `today` and passes it on; `MealSlot` renders `<MealRating client:visible>` under the chosen meal when `isRateable(chosen.meal_date, today)`, else, if the chosen meal has a rating, a static read-only line ("😋 Chef's kiss", with `sr-only` "Your rating:"). Both pages pass `todayInWarsaw(new Date())`.

**Contract**: `WeekPlan` and `MealSlot` gain a required `today: string` prop.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check and build pass: `npx astro check && npm run build`

#### Manual Verification:

- On "This week", the faces appear only on meals dated today or earlier; tapping saves, survives a reload, tapping the selected face clears
- The faces hydrate on the dashboard while "This week" is a hidden tab and when it is opened (nested island inside `PlanTabs`)
- On the previous week's `/history/<id>`, only meals dated `today-7` or later have faces; an older week shows ratings read-only
- Light and dark mode look right; the buttons fit at phone width (375px) without horizontal scroll

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Rating on later plans, smoke test and docs

### Overview

Show the latest earlier rating in the "Next week" editor, cover the flow in the smoke test, and document it.

### Changes Required:

#### 1. Load ratings for the upcoming plan

**File**: `src/pages/dashboard.astro`

**Intent**: Load `getPlanRatings(upcomingPlan.id)` in parallel with `getPlanRecency`; on failure log `dashboard ratings load failed: …` and render without ratings (an annotation, like recency).

**Contract**: Passes `ratings: Record<string, number>` to `UpcomingWeekEditor`.

#### 2. Show it in the editor

**File**: `src/components/plan/UpcomingWeekEditor.tsx` (and a shared `RatingNote` if it keeps the editor readable)

**Intent**: Under each option, next to the recency line, show "Last rated 😋 Chef's kiss" in muted text when a rating exists, with or without a recency note. Ratings don't change when the user swaps (they come from other days), so they stay a static prop, not hook state.

**Contract**: New prop `ratings: Record<string, number>` (option id → 1–5).

#### 3. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: After the current and upcoming weeks are delivered for the smoke user: `POST /api/ratings` without a session → 401; rate the chosen Monday meal of the current week (a slot whose meal isn't renamed) → 200; the dashboard's "This week" shows that face pressed (`aria-pressed="true"` under `data-rating-option-id`); the "Next week" option with the same meal shows "Chef's kiss" (or whichever label was sent) although the current week was never saved; rating an upcoming option → 409 `not_rateable`; a non-chosen current-week option → 409; an invalid rating (6) → 400; clearing (`null`) → 200 and the face is no longer pressed; then rate again so later steps see a rating.

#### 4. README

**File**: `README.md`

**Intent**: A "Rating recent meals" subsection (the window, chosen-only, change/clear, where the faces appear, the route table row and responses, "latest by meal day" on the Next week tab), a smoke-section sentence for the new steps, and a dev-walkthrough step. Note the migration push timing (as for earlier migrations).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check and build pass: `npx astro check && npm run build`
- Database tests pass: `npx supabase test db`
- Smoke passes against the preview on :4322: `npm run build && npx astro preview --port 4322` then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_KEY=… npm run smoke`

#### Manual Verification:

- Following the dev walkthrough, a meal rated on "This week" shows its face on the same meal in "Next week", with and without a recency note
- Re-rating an older occurrence doesn't change what "Next week" shows when a newer occurrence is rated

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isRateable`: today, `today-7`, `today+1`, `today-8`, across a month boundary
- `RATING_FACES` order and `ratingFace` lookup

### Integration Tests:

- pgTAP `meal_ratings.test.sql`: window, chosen-only, ownership, clear, constraint, privileges, "latest by meal day"
- Smoke: write path codes, persistence, cross-week display without a saved plan

### Manual Testing Steps:

1. Deliver this week and next week (README walkthrough); rate Monday's meal on "This week"; reload.
2. Open "Next week": the same meal shows the face.
3. Tap the selected face again: cleared; "Next week" no longer shows it after reload.
4. Leave the page open past midnight on a meal dated `today-7`, then tap: the "closed" message appears and the controls lock.

## Performance Considerations

Up to ~12 small islands per week view (`client:visible`, a few buttons each) and one extra RPC on the dashboard, run in parallel with recency. The `get_plan_ratings` join is per user and small (2–4 users); it can use `plan_meal_options_chosen_history_idx` because rated rows are always chosen.

## Migration Notes

New table and functions only; no backfill. Push the migration to production (`npx supabase db push`) after the PR's CI is green and before merging, as the README requires for earlier migrations.

## References

- Roadmap: `context/foundation/roadmap.md` (S-08); PRD: FR-013, US-08
- Issue: #11
- Similar implementation: `supabase/migrations/20261003120000_plan_choices.sql:102-160`, `src/lib/plan-save.ts`, `src/components/hooks/usePlanChoices.ts`
- Phase sub-issues: #86 (Phase 1), #87 (Phase 2), #88 (Phase 3), #89 (Phase 4)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — ratings table and functions

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset` — e64f570
- [x] 1.2 Database tests pass: `npx supabase test db` — e64f570

#### Manual

- [x] 1.3 The table, policy and both functions look right in local Studio, with RLS enabled on `meal_ratings` — e64f570

### Phase 2: Rating API and domain helpers

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — bbdf424
- [x] 2.2 Lint passes: `npm run lint` — bbdf424
- [x] 2.3 Type check and build pass: `npx astro check && npm run build` — bbdf424

#### Manual

- [x] 2.4 With `npm run dev`, a `curl` with a signed-in session cookie rates this week's Monday meal (200) and an upcoming meal (409 `not_rateable`) — bbdf424

### Phase 3: Rating on the week views

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — 2eb40c1
- [x] 3.2 Lint passes: `npm run lint` — 2eb40c1
- [x] 3.3 Type check and build pass: `npx astro check && npm run build` — 2eb40c1

#### Manual

- [x] 3.4 On "This week", the faces appear only on meals dated today or earlier; tapping saves, survives a reload, tapping the selected face clears — 2eb40c1
- [x] 3.5 The faces hydrate on the dashboard while "This week" is a hidden tab and when it is opened (nested island inside `PlanTabs`) — 2eb40c1
- [x] 3.6 On the previous week's `/history/<id>`, only meals dated `today-7` or later have faces; an older week shows ratings read-only — 2eb40c1
- [x] 3.7 Light and dark mode look right; the buttons fit at phone width (375px) without horizontal scroll — 2eb40c1

### Phase 4: Rating on later plans, smoke test and docs

#### Automated

- [x] 4.1 Unit tests pass: `npm test`
- [x] 4.2 Lint passes: `npm run lint`
- [x] 4.3 Type check and build pass: `npx astro check && npm run build`
- [x] 4.4 Database tests pass: `npx supabase test db`
- [x] 4.5 Smoke passes against the preview on :4322

#### Manual

- [x] 4.6 Following the dev walkthrough, a meal rated on "This week" shows its face on the same meal in "Next week", with and without a recency note
- [x] 4.7 Re-rating an older occurrence doesn't change what "Next week" shows when a newer occurrence is rated
