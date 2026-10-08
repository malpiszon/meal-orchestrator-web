# "Next week" Shows the Nearest Upcoming Week Implementation Plan

## Overview

The dashboard's "Next week" tab shows the user's **nearest** future week (`week_start > today` in Europe/Warsaw,
earliest first) instead of the latest one. A later future week is stored as before but stays hidden until the
nearer one starts; then the nearer one moves to "This week" and the later one becomes "Next week". The smoke's
cross-week recency step, which relied on a later week replacing the saved upcoming one, becomes a same-week
recency check plus a check that "Next week" stays on the nearer week when two future weeks are delivered.

## Current State Analysis

From `frame.md` (confidence HIGH):

- `getUpcomingPlan` (`src/lib/services/plans.ts:18-39`) picks `week_start > today`, ordered **descending**,
  `limit(1)`. S-01 chose "latest wins" as a tie-break with one tab
  (`context/archive/2026-09-30-mo-weekly-delivery/plan.md:102`); S-02's review F4 kept it because MO delivers
  only the following week (`context/archive/2026-10-02-recency-annotated-plan/reviews/impl-review.md:55-75`).
- With two future weeks, the nearer week (earliest edit deadline) is unreachable. It turns into "This week" never
  seen and never saved, so it never feeds recency notes either.
- Nothing after selection depends on the rule: the cut-off is `week_start > today` for any week
  (`supabase/migrations/20261003120000_plan_choices.sql:6`); recency and ratings take the selected `planId`
  (`src/pages/dashboard.astro:44-63`); no SQL orders by or takes the max of `week_start`.
- MO targets the nearest upcoming Monday, but mo-web accepts any future Monday (`src/lib/mo-delivery.ts:97`).
  Per the user, far-ahead deliveries are legitimate input (MO may deliver earlier in future) and stay accepted.
- Fallout: the smoke's later-week steps (`scripts/smoke.mjs:298-304`, `:866-890`), `upcomingMonday()`'s JSDoc
  (`scripts/smoke.mjs:139-145`), README walkthrough step 6 and the README smoke description describe or rely on
  "latest future week".

## Desired End State

- With W+1 and W+2 delivered, `/dashboard` "Next week" shows W+1; W+2 appears nowhere on the dashboard.
- With one future week, nothing changes.
- The smoke covers both: two future weeks delivered (the nearer, saved week stays on "Next week") and a recency
  note rendered on the dashboard after a real save (same-week repeat of the swapped-to meal).
- README describes the rule and the walkthrough no longer promises a later week replacing "Next week".

### Key Discoveries:

- `get_plan_recency` matches by `provider_meal_id` against chosen options of saved plans on any earlier
  `meal_date`, including earlier days of the same plan
  (`supabase/migrations/20261007120000_recency_saved_plans_only.sql:16-38`).
- The delivery schema only rejects a duplicate `provider_meal_id` **within one meal**
  (`src/lib/mo-delivery.ts:59`); repeating a meal id on another day is valid. `plan_meal_options` is unique on
  `(plan_id, meal_date, meal_type, variant_index)` only.
- No meal id repeats in `scripts/fixtures/mo-delivery.sample.json`, so a repeat must be added to the smoke's copy.
- Note text: `formatRecency` → `In your plan 1 day earlier (Mon 12 Oct)` (`src/lib/plans.ts:146-156`).
- Cross-week recency from saved plans is covered in pgTAP (`supabase/tests/get_plan_recency.test.sql`).
- The smoke step "neither tab contains 'In your plan'" (`scripts/smoke.mjs:~572`) runs before the swap; with the
  repeated meal it now also proves an unsaved plan gives no same-week note.

## What We're NOT Doing

- No tab, list or other view for a second future week; it stays hidden until it is the nearest.
- No change to the delivery endpoint: far-ahead weeks stay accepted and stored.
- No change to `getCurrentPlan`, the edit cut-off, recency, ratings, history or any SQL; no migration.
- No end-to-end cross-week recency check in the smoke (pgTAP covers it; the smoke can't move the clock).
- No PRD change; README walkthrough step 6 changes meaning (see Phase 1).

## Implementation Approach

One query direction flip, pinned by a unit test, and a rework of the smoke and README in the same phase so the
smoke never goes red between commits.

## Phase 1: Nearest future week, smoke and docs

### Overview

Switch the selection rule, rework the smoke's later-week steps around the new rule, and update the README.

### Changes Required:

#### 1. Selection rule

**File**: `src/lib/services/plans.ts`

**Intent**: Make "Next week" the nearest future week, so the week with the earliest edit deadline is the one the
user can see, swap and save.

**Contract**: `getUpcomingPlan` orders by `week_start` ascending (still `limit(1)`, same filters and signature).
Its JSDoc says "the nearest `weekly_plans` row with `week_start > today`" and that a later future week stays
hidden until the nearer one starts.

#### 2. Unit test

**File**: `src/lib/services/plans.test.ts`

**Intent**: Pin the direction so a regression to "latest" fails a test.

**Contract**: The existing builder mock records the `order` call; a test asserts
`order("week_start", { ascending: true })` and the `gt("week_start", today)` filter.

#### 3. Smoke: same-week recency note

**File**: `scripts/smoke.mjs`

**Intent**: Keep an end-to-end check that a recency note renders after a real save, without needing a later week
on "Next week".

**Contract**:
- In `delivery` (the upcoming week, built before `redelivery` is cloned from it), replace one **non-recommended**
  variant of `days[1].meals[0]` with `provider_meal_id` = the swap option's id and a unique name
  (`repeatName = "Smoke repeated meal <ts>"`). Exit with a fixture-problem message if the sample has no second
  day or that meal has fewer than two variants. Same-week repeats on later days only: `days[1]` is after
  `days[0]`.
- `repeatNote = "In your plan ${daysBetween(days[0].date, days[1].date)} day(s) earlier ("`, matching
  `formatRecency`'s singular/plural.
- The pre-swap "no recency note" step keeps asserting no `In your plan` in either tab (now also covering the
  repeated meal while the plan is unsaved).

#### 4. Smoke: two future weeks

**File**: `scripts/smoke.mjs`

**Intent**: Cover the DoD "two future weeks delivered at once": the nearer, saved week stays on "Next week".

**Contract**: Replace the two later-week steps (`:866-890`):
- `laterDelivery` (Monday 7 days after the upcoming week) gets a meal renamed only there
  (`laterName = "Smoke later-week meal <ts>"`) instead of `newName`; drop `recencyNote` and its 7-day logic.
- Step "delivery of a later week for the signed-in user is stored": unchanged expectations (200,
  `account_created: false`).
- Step "Next week stays on the nearer week, with its same-week note": `/dashboard` 200; the body contains no
  `laterName`; "Next week" has `swapName` checked and `Saved `; its `repeatName` option label contains
  `repeatNote`; its `newName` option (the swapped-away recommendation) has no `In your plan`; "This week" has no
  `In your plan`.
- Update `upcomingMonday()`'s JSDoc (`:139-145`): "Next week" shows the nearest future plan; the later week
  stays hidden. Update the comment above `laterWeek` (`:298-300`).

#### 5. README

**File**: `README.md`

**Intent**: Document the rule and keep the walkthrough truthful.

**Contract**:
- "Swapping and saving the upcoming plan": one sentence: "Next week" is the nearest week whose Monday is after
  today (Europe/Warsaw); a later delivered week is stored but shown only once the nearer one has started.
- Walkthrough step 6: deliver the Monday after the saved upcoming week; reload: "Next week" still shows the saved
  week, the later week isn't shown until the saved one starts, and then its meals carry notes such as "In your
  plan 7 days earlier (…)" from the saved week. Keep the "had you not saved…" sentence.
- Smoke description (`## Smoke test`, the delivery paragraph): replace the "week 7 days after the saved upcoming
  week shows a recency note" clause with the two new checks (repeated meal note after the swap; later week
  delivered, "Next week" stays on the saved week and doesn't show the later week's meal).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass, including the new `getUpcomingPlan` order test: `npm test`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes against the preview on :4323: `npx astro preview --port 4323`, then
  `BASE_URL=http://localhost:4323 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 npm run smoke`

#### Manual Verification:

- Walkthrough with two future weeks: after delivering W+1 (saved) and W+2, `/dashboard` "Next week" shows W+1's
  dates and swap; W+2 is not visible
- README walkthrough step 6 reads correctly against the running app

**Implementation Note**: After automated verification passes, pause for the user's manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `getUpcomingPlan` orders ascending and filters `week_start > today`.

### Integration Tests:

- Smoke: unsaved upcoming week with a repeated meal shows no note; after the swap the repeat shows
  `In your plan 1 day earlier (`; a later week delivered leaves "Next week" on the saved week without the later
  week's meal.
- pgTAP (unchanged) keeps cross-week recency covered.

### Manual Testing Steps:

1. Deliver W+1 and W+2 for a local user (README step 1, two `start` values); save a swap in W+1.
2. Reload `/dashboard`: "Next week" shows W+1 with the swap; W+2 is absent.

## Performance Considerations

None: same query, different order.

## Migration Notes

No migration and no production setup step. Users who today have two future weeks (none in practice) will see the
nearer one after deploy.

## References

- Frame brief: `context/changes/next-week-nearest-upcoming/frame.md`
- Source: `src/lib/services/plans.ts:18-39`, `src/lib/services/plans.test.ts`, `scripts/smoke.mjs:139-145`,
  `:298-304`, `:866-890`, `src/lib/plans.ts:146-156`,
  `supabase/migrations/20261007120000_recency_saved_plans_only.sql`
- Prior decisions: `context/archive/2026-10-02-recency-annotated-plan/reviews/impl-review.md` (F4)
- Issue: #84
- Phase sub-issues: Phase 1 → #95

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Nearest future week, smoke and docs

#### Automated

- [x] 1.1 Lint passes
- [x] 1.2 Unit tests pass, including the new getUpcomingPlan order test
- [x] 1.3 Type check passes
- [x] 1.4 Build passes
- [x] 1.5 Smoke passes against the preview on :4323

#### Manual

- [x] 1.6 Walkthrough with two future weeks: "Next week" shows W+1, W+2 not visible
- [x] 1.7 README walkthrough step 6 reads correctly against the running app
