# Rating-ordered options (S-13) Implementation Plan

## Overview

Each meal slot's order, star and (on a plan the user hasn't saved) default choice come from one
rating-adjusted score, built from MO's score and the user's own latest earlier rating of the meal. 5/5
meals go first, 1/5 meals last, so a meal rated 🤢 Never again is no longer preselected or listed on top.
Roadmap S-13, issue #93. Frame: `context/changes/rating-ordered-options/frame.md`.

## Current State Analysis

- **Order and star are MO's score only.** `groupPlanOptions` sorts by `byScoreThenIndex`
  (`src/lib/plans.ts:36-80`); every option whose score equals `topScore` gets the star
  (`src/components/plan/UpcomingWeekEditor.tsx:100`). Ratings reach the editor only as the "Last rated"
  note (`UpcomingWeekEditor.tsx:83,121`).
- **The default choice is stored data.** `ingest_weekly_plan` inserts `is_chosen = is_recommended` for a
  never-saved plan, and MO's recommendation as the fallback of a saved plan whose kept dish is gone
  (`supabase/migrations/20261006120000_week_resubmission_rules.sql`, the `case … else r.is_recommended`
  in the option insert). `confirm_plan` ("Keep as recommended") saves the current `is_chosen` rows,
  `rate_meal` only accepts `is_chosen` rows (`20261008120000_meal_ratings.sql:55-67`), and history labels
  an unsaved week "Not saved: MO's recommendation" (`src/lib/plans.ts:187-190`).
- **The rating that counts** is the user's rating of the same meal (same user, provider and
  `provider_meal_id`) from the most recent rated meal day strictly before the option's day:
  `get_plan_ratings` (`20261008120000_meal_ratings.sql:95-119`). It is `security invoker` and relies on
  RLS (`auth.uid()`), so ingest (service role) can't use it.
- **Locks.** `ingest_weekly_plan`, `choose_plan_option` (`for update of p`) and `confirm_plan`
  (`for update`) all lock the `weekly_plans` row; one chosen row per slot is enforced by the partial
  unique index `plan_meal_options_one_chosen_per_slot` (`20261003120000_plan_choices.sql`).
- **Read-only views** (`WeekPlan.astro` → `MealSlot.astro`) show the chosen meal, then "Other options"
  in score order, with no earlier-ratings lookup and no star.
- **Smoke** assumes chosen = MO's pick on unsaved weeks (`recommendedIndex`, `scripts/smoke.mjs:182`)
  and gives the 5/5 rating (line ~618) before the upcoming week is swapped (line ~764), so in the smoke
  the upcoming plan is unsaved when the rating lands.

## Desired End State

- On "Next week", each slot lists options by adjusted score (then MO score, then menu order). The star
  marks the first option and any option tied with it on both adjusted score and MO score. On a plan
  the user hasn't saved, the selected option is that first option.
- The stored `is_chosen` of a never-saved plan is the same option, whether the ratings existed at
  delivery or arrived later (until the week starts). So "Keep these picks" saves what is shown, the
  started week's rateable meal is that pick, and history's unsaved status reads "Not saved: suggested
  picks".
- A saved plan is never re-picked; on re-delivery, a slot whose kept dish is gone gets the adjusted
  pick instead of MO's recommendation.
- Verify with pgTAP (`npx supabase test db`), Vitest (`npm test`), and the smoke on :4323.

### Key Discoveries:

- Adjusted score (decided): 5/5 → always top, 1/5 → always bottom, 4/5 → score + 2, 2/5 → score − 2,
  3/5 and unrated → score. MO scores are 1–10, so ±100 for 5/5 and 1/5 keeps them in their own bands
  while MO's score still orders meals inside a band (two 5/5 meals: 9/10 before 7/10).
- Tie-break (decided): adjusted score desc → MO score desc → `variant_index` asc. Worked case: A 9/10
  unrated vs B 7/10 rated 4/5 → both 9 → A first, A alone starred, A preselected.
- `ratings.ts` imports `addDays` from `plans.ts`, so the adjusted-score helper goes in `plans.ts` to
  avoid an import cycle.
- Recency notes count only saved plans (`20261007120000_recency_saved_plans_only.sql`), so re-picking
  an unsaved plan never changes recency.

## What We're NOT Doing

- No ordering by rating on the read-only views ("This week", `/history/<id>`): the chosen meal stays
  first and "Other options" keeps MO's score order (frame: "rest, whatever is easier"). The stored pick
  still applies there, since it is `is_chosen`.
- No change to which rating counts (latest earlier rated day, as "Last rated" shows).
- No re-pick of a saved plan, nor of a week that has started (its `is_chosen` is what the user had and
  what ratings attach to).
- No re-pick when the dashboard loads (no writes on GET), and no live update of an open "Next week" tab
  after a rating elsewhere: it shows the new pick after a reload.
- No removal of `is_recommended`: it stays stored as MO's pick (used by the re-delivery carry-over
  and `PlanMealOption` type), it just stops deciding the default.
- No mo-web → MO feedback of ratings (PRD Non-Goal).

## Implementation Approach

The rule lives in two places on purpose: SQL decides the stored default (ingest and late ratings), and
TypeScript decides the order and star on "Next week" from the ratings `get_plan_ratings` already loads.
Both use the same formula and tie-break, and their tests share the same worked cases (A/B tie, two 5/5,
1/5 recommended by MO, unrated vs 3/5) so they can't drift silently.

Database first (Phase 1), so the stored default is right before the UI relies on "selected = first";
then the app (Phase 2); then smoke and README (Phase 3).

## Critical Implementation Details

- **Shared local Supabase.** Per `CLAUDE.local.md`, the local stack is shared with the S-09
  (`landing-page`) worktree. Before applying the Phase 1 migration (or running `npx supabase test db`
  against it), stop and ask the user: wait until S-09's gates are done, or give this worktree its own
  stack. Never `db reset`, stop or restart the stack without asking. Preview/smoke run on port 4323.
- **Lock order in `rate_meal`.** The re-pick may lock several plan rows. Lock them in one statement
  ordered by `week_start` (or id) so two concurrent ratings can't deadlock, then re-check
  `saved_at is null` and `week_start > today` after the lock: a plan saved or started meanwhile is
  skipped. Clear the plan's `is_chosen` rows in one statement and set the new picks in a second, so the
  partial unique index never sees two chosen rows in a slot.
- **Security definer scope.** `rate_meal` bypasses RLS: the re-pick must only touch plans of the
  caller (`v_user_id`) with the rated meal's `provider` and `provider_meal_id`.

## Phase 1: Database — rating-adjusted defaults

### Overview

A migration adds the adjusted-score rule and a pick helper in SQL, uses it in `ingest_weekly_plan` for
never-saved plans and the saved-plan fallback, and makes `rate_meal` re-pick the caller's affected
unsaved, not-yet-started plans.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261008180000_rating_ordered_defaults.sql`

**Intent**: Store mo-web's best guess, not MO's pick, as the default choice, and keep it current when
a late rating arrives. Header comment states the rules, as the earlier migrations do.

**Contract**:
- `public.adjusted_score(p_score smallint, p_rating smallint) returns integer`, `immutable`:
  `5 → p_score + 100`, `1 → p_score - 100`, `4 → p_score + 2`, `2 → p_score - 2`, otherwise (3, null)
  `p_score`. Execute revoked from `public, anon` (internal helper; granting `authenticated` is
  unnecessary).
- `public.pick_default_choices(p_plan_id uuid) returns void`, `security definer`,
  `set search_path = ''`, execute revoked from `public, anon, authenticated` (called only by other
  definer functions). For every slot (`meal_date`, `meal_type`) of the plan that has **no** chosen
  row, sets `is_chosen = true` on the option ordered first by
  `adjusted_score(score, latest earlier rating) desc, score desc, variant_index asc`. The rating lookup
  follows `get_plan_ratings` exactly (same user as the plan, same `weekly_plans.provider`, same
  `provider_meal_id`, chosen history rows with `meal_date` strictly before the option's, latest
  `meal_date` then latest `rated_at`), filtered by the plan's `user_id` instead of RLS.
- `public.ingest_weekly_plan(...)`: same signature and rules; the option insert sets
  `is_chosen = r.slot_has_kept and r.is_kept and r.kept_rank = 1` (false elsewhere), then calls
  `pick_default_choices(v_plan_id)`. So a never-saved plan gets the adjusted pick in every slot, and a
  saved plan gets it where the kept dish is gone or the slot is new. Header comment of the function
  updated (the "MO's new recommendation" wording).
- `public.rate_meal(p_option_id, p_rating)`: same signature, errors and grants. After storing or
  clearing the rating, it locks (`for update`, ordered) the caller's plans with `saved_at is null`,
  `week_start > today` (Europe/Warsaw), the rated plan's `provider`, and an option with the rated
  option's `provider_meal_id`; for each, clears its `is_chosen` rows and calls
  `pick_default_choices`. The rated option's own week has started, so it is never re-picked.
- `get_plan_ratings`, `choose_plan_option`, `confirm_plan`: unchanged.

#### 2. pgTAP tests

**File**: `supabase/tests/rating_ordered_defaults.test.sql` (new); adjust
`supabase/tests/week_resubmission.test.sql` and `supabase/tests/meal_ratings.test.sql` only where an
existing assertion relied on "fallback = MO's recommendation" with ratings present (likely none, as
their fixtures have no earlier ratings for the re-sent meals).

**Intent**: Pin the scoring, tie-break, ingest pick, saved-plan fallback and the late re-pick with its
safeguards.

**Contract**: dates relative to today in Europe/Warsaw, as `meal_ratings.test.sql` does. Cases:
- `adjusted_score`: each of 1–5 and null.
- Ingest of a never-saved week: MO recommends a meal rated 1/5 earlier → another option is chosen;
  a 5/5 meal with a low MO score is chosen; A 9/10 unrated vs B 7/10 rated 4/5 → A; two options with
  equal adjusted and MO score → lowest `variant_index`; an unrated week → same as `is_recommended`.
- The rating used is the latest earlier rated day (older 5/5, newer 1/5 → treated as 1/5).
- Ratings of another user, or of the same `provider_meal_id` under another provider, are ignored.
- Saved-plan re-delivery: kept dish offered → kept; kept dish gone → adjusted pick, not MO's
  recommendation; `saved_at` kept.
- `rate_meal` late rating: rating a meal 1/5 re-picks the caller's unsaved upcoming plan that
  preselected it; clearing the rating re-picks back; a saved upcoming plan, a started unsaved plan and
  another user's unsaved plan offering the same meal are untouched; exactly one chosen row per slot
  afterwards.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to the local stack (after the user's go-ahead): `npx supabase migration up`
- pgTAP tests pass: `npx supabase test db`
- The new test file covers every case listed above (adjusted_score, ingest pick, tie-break, latest rating, other user/provider, saved fallback, late re-pick safeguards)

#### Manual Verification:

- In Studio, a never-saved upcoming plan whose MO-recommended meal was rated 1/5 earlier has another option chosen

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: App — order, star and wording

### Overview

"Next week" orders and stars options by the same adjusted score, and the never-saved wording no longer
credits MO.

### Changes Required:

#### 1. Plan helpers

**File**: `src/lib/plans.ts`

**Intent**: One TS copy of the scoring rule, used by the sort and the star.

**Contract**:
- `export function adjustedScore(score: number, rating: number | undefined): number`, same mapping
  as the SQL `adjusted_score`.
- `GroupableOption` gains `id: string`.
- `groupPlanOptions(rows, ratings?: ReadonlyMap<string, number>)`: without `ratings` the order is as
  today (MO score, then index). With them, sort by adjusted score desc, score desc, `variant_index`
  asc. `chosen` = the `is_chosen` row, else the first option (the `is_recommended` fallback is
  dropped: the database always stores a chosen row, and the default is no longer MO's pick).
- `PlanSlot.topScore` is replaced by `starredIds: string[]`: the first option plus any option tied
  with it on both adjusted score and MO score (so without ratings, every top-MO-score option is starred,
  as today).
- `formatPlanSavedStatus(null)` → `"Not saved: suggested picks"`.

**File**: `src/types.ts` — update `PlanSlot` (`starredIds`, doc comments: "best first" means adjusted
order; `chosen` falls back to the first option) and the `is_chosen` comment ("mo-web's suggested pick
until the user swaps").

#### 2. Dashboard and editor

**File**: `src/pages/dashboard.astro`, `src/components/plan/UpcomingWeekEditor.tsx`

**Intent**: Pass the loaded ratings into grouping so order, star and selection agree; rename the
confirm button.

**Contract**:
- Dashboard: the editor option mapping includes `id` (already) and `groupPlanOptions(..., upcomingRatings)`;
  `EditorSlot` carries `starredIds` instead of `topScore`. If the ratings failed to load, grouping
  runs without them (MO order) and the page still renders.
- Editor: star shown when `slot.starredIds.includes(option.id)`; its sr-only label becomes
  "Top pick". Button text "Keep these picks".
- `WeekPlan.astro` keeps calling `groupPlanOptions` without ratings; `MealSlot.astro` unchanged.

#### 3. Vitest

**File**: `src/lib/plans.test.ts`

**Intent**: Pin the TS rule with the same worked cases as pgTAP.

**Contract**: `adjustedScore` for 1–5 and undefined; `groupPlanOptions` with ratings: 1/5 recommended
option listed last, 5/5 low-score option first, A/B tie → A first and alone in `starredIds`, two 5/5
ordered by MO score, two identical unrated top scores both starred; without ratings, existing order
tests still hold (rename `topScore` assertions to `starredIds`); `chosen` falls back to the first
option when no row is chosen; `formatPlanSavedStatus(null)` new text.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- On :4323, an unsaved "Next week" with a meal rated 1/5 earlier lists it last, with another option selected and starred
- "Keep these picks" saves the shown selection, and history shows "Not saved: suggested picks" for a never-saved past week

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Smoke and README

### Overview

The smoke proves the late re-pick and the adjusted order end to end, existing steps follow the new
wording, and the README describes the new rule.

### Changes Required:

#### 1. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Cover the visible outcome of this slice and keep existing steps true.

**Contract**:
- Fixture: in the upcoming delivery, plant the rated meal (the current week's Monday second meal's
  recommended option, `ratedName`'s `provider_meal_id`) as a **non-recommended** option of another
  slot, under a unique name, in the same way the repeated-meal trick does; fail with "Fixture problem"
  if the sample can't host it. Check it doesn't collide with the swap, repeat and rename slots.
- New step after "meal is rated again" (5/5, upcoming week still unsaved): the dashboard's "Next week"
  shows the planted option `checked`, listed first in its slot, with the star — the late re-pick.
- 1/5 case (issue #93's Definition of done): rate a second chosen meal of the current week 1/5 whose
  meal (same `provider_meal_id`) is MO's recommendation in another upcoming slot (plant it there if
  the sample has none), not the swap, repeat, rename or 5/5 slot. While the upcoming week is unsaved,
  "Next week" lists that option last in its slot, not `checked` and without the star.
- Existing steps: "history week page shows its meal" expects "Not saved: suggested picks"; review
  every step that uses `recommendedIndex` on the upcoming week after the rating (the swap, the
  re-delivery carry-over, the repeat note) and keep each one's intent. The planted slot must not be
  the swap slot.
- Each re-run creates a fresh smoke user (`smoke-${Date.now()}`), so earlier runs' ratings don't
  leak in.

#### 2. README

**File**: `README.md`

**Intent**: Describe the rule where the behaviour is documented. Keep edits to S-13's sentences (S-09
also edits the README).

**Contract**:
- "Swapping and saving the upcoming plan": selection = mo-web's suggested pick (MO's score adjusted by
  the user's ratings: rule and tie-break in one or two sentences), star = top of that order, button
  "Keep these picks"; re-delivery: "where the dish is gone, the suggested pick is chosen"; a rating
  given later re-picks unsaved upcoming weeks; the open-tab "Keep these picks" caveat.
- "Plan history": "Not saved: suggested picks".
- "Rating recent meals": "Only the chosen meal of a slot can be rated (the suggested pick when the plan
  was never saved…)"; mention that ratings also order "Next week".
- Walkthrough steps 5 and 7, and the Smoke test paragraph, for the new wording and the new step.
- Production setup paragraph listing migrations: add `rating_ordered_defaults` and
  `repick_unsaved_upcoming_plans` (push before merge; between the push and the deploy the old Worker
  briefly shows re-picked selections that aren't first or starred, review F5).

### Success Criteria:

#### Automated Verification:

- Smoke passes against the preview, including the 5/5-first and 1/5-last steps: `npm run build && npx astro preview --port 4323`, then `BASE_URL=http://localhost:4323 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 npm run smoke`
- Lint and format pass: `npm run lint` and `npx prettier --check README.md`

#### Manual Verification:

- README walkthrough steps 5 and 7 read correctly against the running app

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `adjustedScore` mapping and `groupPlanOptions` order/star/chosen with and without ratings.
- `formatPlanSavedStatus` wording.

### Integration Tests:

- pgTAP: ingest pick, tie-break, latest-rating rule, other user/provider isolation, saved-plan
  fallback, `rate_meal` re-pick and its safeguards (saved, started, other user, one chosen per slot).
- Smoke: late re-pick visible on the dashboard (5/5 first, checked, starred; 1/5 last, not checked); existing delivery, swap, re-delivery, history and
  rating steps still pass.

### Manual Testing Steps:

1. Deliver a current week, rate its Monday meal 1/5, deliver an upcoming week where MO recommends that
   meal: "Next week" lists it last and selects another, starred option.
2. Rate a "This week" meal 5/5 while an unsaved upcoming week offers it unrecommended; reload: it is
   selected, first and starred.
3. Swap a meal (saved), then rate another offered meal: the saved selection doesn't change.

## Performance Considerations

The re-pick adds work to `rate_meal` only when the caller has unsaved future plans offering the rated
meal (normally 0–1 plans, a few dozen rows). Ingest adds one rating lookup per delivery over the user's
own history, using `plan_meal_options_chosen_history_idx`.

## Migration Notes

- Existing stored plans are not re-picked by `20261008180000_rating_ordered_defaults`; only deliveries
  and ratings after it apply the rule. Addendum 2026-10-09: a second, one-time migration
  `20261009090000_repick_unsaved_upcoming_plans` re-picks every unsaved, not-yet-started plan (see
  "Addendum" below), so no plan stored before deploy keeps MO's pick.
- Production: push both migrations with `npx supabase db push` after the PR's CI is green and before
  merging, as for earlier migrations (README "Production setup").
- Rollback: a follow-up migration restoring the previous `ingest_weekly_plan` and `rate_meal` bodies;
  stored picks stay valid either way.

## Addendum (2026-10-09, Phase 2 manual testing)

- Plans stored before the Phase 1 migration kept MO's pick as `is_chosen`, so with Phase 2 the
  selected option could be listed last while another one was starred (seen on 12 Oct breakfast). At
  the user's request, `supabase/migrations/20261009090000_repick_unsaved_upcoming_plans.sql` was added
  in the Phase 2 commit: a one-time DO block that, for every plan with `saved_at is null` and
  `week_start` after today (Europe/Warsaw), clears `is_chosen` and calls `pick_default_choices`, locking
  plans in `week_start, id` order as `rate_meal` does. Saved plans and started weeks are untouched.
- It overrides "Existing plans are not re-picked" in `plan-brief.md` and in the header of
  `20261008180000_rating_ordered_defaults.sql` (left as is: that migration indeed doesn't re-pick).
- No pgTAP test: CI builds the database from empty migrations, so the block does nothing there; it was
  verified on the local stack (two upcoming weeks, 3 slots each re-picked; started weeks unchanged).

## References

- Frame: `context/changes/rating-ordered-options/frame.md`
- Roadmap: `context/foundation/roadmap.md` § S-13; issue #93
- Source: `src/lib/plans.ts:36-80,187-190`, `src/components/plan/UpcomingWeekEditor.tsx:63-140,188`,
  `src/pages/dashboard.astro:69-90`, `src/types.ts:53,80-90`,
  `supabase/migrations/20261006120000_week_resubmission_rules.sql`,
  `supabase/migrations/20261008120000_meal_ratings.sql:39-119`,
  `supabase/migrations/20261003120000_plan_choices.sql`, `scripts/smoke.mjs:182,304-311,600-685`
- Phase sub-issues: #101 (Phase 1), #102 (Phase 2, blocked by #101), #103 (Phase 3, blocked by #102)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — rating-adjusted defaults

#### Automated

- [x] 1.1 Migration applies cleanly to the local stack (after the user's go-ahead): `npx supabase migration up` — dc38f8f
- [x] 1.2 pgTAP tests pass: `npx supabase test db` — dc38f8f
- [x] 1.3 The new test file covers every case listed above (adjusted_score, ingest pick, tie-break, latest rating, other user/provider, saved fallback, late re-pick safeguards) — dc38f8f

#### Manual

- [x] 1.4 In Studio, a never-saved upcoming plan whose MO-recommended meal was rated 1/5 earlier has another option chosen — dc38f8f

### Phase 2: App — order, star and wording

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — a9f73a9
- [x] 2.2 Lint passes: `npm run lint` — a9f73a9
- [x] 2.3 Type check passes: `npx astro check` — a9f73a9
- [x] 2.4 Build passes: `npm run build` — a9f73a9

#### Manual

- [x] 2.5 On :4323, an unsaved "Next week" with a meal rated 1/5 earlier lists it last, with another option selected and starred — a9f73a9
- [x] 2.6 "Keep these picks" saves the shown selection, and history shows "Not saved: suggested picks" for a never-saved past week — a9f73a9

### Phase 3: Smoke and README

#### Automated

- [x] 3.1 Smoke passes against the preview, including the 5/5-first and 1/5-last steps: `npm run build && npx astro preview --port 4323`, then `BASE_URL=http://localhost:4323 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 npm run smoke` — 0508bc8
- [x] 3.2 Lint and format pass: `npm run lint` and `npx prettier --check README.md` — 0508bc8

#### Manual

- [x] 3.3 README walkthrough steps 5 and 7 read correctly against the running app — 0508bc8
