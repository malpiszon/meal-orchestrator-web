# Recency notes from saved plans only Implementation Plan

## Overview

`get_plan_recency` counts a meal as "planned earlier" only when its plan was saved (`weekly_plans.saved_at is not null`: swapped at least once, or kept as recommended). A never-saved plan still becomes history (FR-011) and counts from the moment the user saves it. The rule is applied at query time, so existing history needs no data migration. Roadmap item S-11, issue #78; requirement change from first user feedback (PRD FR-008 update, 2026-10-06).

## Current State Analysis

- `public.get_plan_recency(p_plan_id)` (latest definition `supabase/migrations/20261003120000_plan_choices.sql`, last statement) joins each option of the plan to earlier `is_chosen` options of the same user, provider and `provider_meal_id`, in any plan, regardless of whether that plan was saved. A never-saved week therefore counts as eaten (MO's recommendations are `is_chosen` by default), which produced the false notes users reported.
- Its only callers are `getPlanRecency` in `src/lib/services/plans.ts:81` (dashboard load, `src/pages/dashboard.astro:46`, and the save routes' re-read in `src/lib/plan-save.ts:88`). Both just render whatever rows come back, so no TypeScript change is needed.
- `weekly_plans.saved_at` is set by `choose_plan_option` and `confirm_plan`, reset to null only by a changed re-delivery of an upcoming week that was never saved; saved plans keep it (S-06, `20261006120000_week_resubmission_rules.sql`). A started week can no longer be saved, so a week delivered too late to edit stays `saved_at is null` forever.
- `supabase/tests/get_plan_recency.test.sql` pins the current rule with fixtures whose plans all have `saved_at` null.
- `scripts/smoke.mjs` (lines ~232-241, ~455-470) builds its recency history from a delivered current-week plan, which can never be saved, and asserts a "In your plan N days earlier (" note on the upcoming week. Under the new rule that note must not appear.
- README documents the old rule in the "Swapping and saving the upcoming plan" section ("Recency notes count the meals the user chose, not the ones MO recommended") and in walkthrough steps 4-5, which show notes from an unsaved current week.

## Desired End State

A meal gets "In your plan N days earlier (…)" only when its most recent earlier occurrence is in a saved plan. Never-saved past weeks, a past week delivered too late to edit, and earlier days of the upcoming week itself while it is unsaved give no notes. Saving the plan (swap or "Keep as recommended") makes that plan count at once, including its own earlier days, and the save route's recency re-read reflects it. No hint is added to the dashboard. Verified by pgTAP, the smoke script and the README walkthrough.

### Key Discoveries:

- The change is one extra predicate on the history plan join (`hp` in `20261003120000_plan_choices.sql`), delivered as a new migration with `create or replace function` (same signature, grants unchanged but re-stated like prior migrations).
- `plan_meal_options_chosen_history_idx` still serves the join; `weekly_plans` is reached by primary key, so no index is needed.
- Postgres tests run in the smoke CI job (`npx supabase test db`); production needs `npx supabase db push` after CI is green and before merge (README "Production setup").

## What We're NOT Doing

- No dashboard hint explaining why a meal has no note (decided 2026-10-06; the status line already says "Not saved yet").
- No data migration or backfill: existing history is judged by `saved_at` at query time, so history from before saving existed (S-03) simply stops producing notes.
- No change to `choose_plan_option`, `confirm_plan` or ingest, and no change to what saving means.
- The parked "stale Keep as recommended" case stays parked.
- No change to how the "This week" tab or the plan UI components render notes.

## Implementation Approach

Fix the rule where the matching already lives (Postgres), prove it with the pgTAP fixtures, then bring the HTTP-level smoke script and the docs in line. Two phases so the SQL rule is verified in isolation before the smoke script is restructured around it.

## Phase 1: Recency counts saved plans only

### Overview

New migration redefining `get_plan_recency`, plus updated pgTAP coverage.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20261007120000_recency_saved_plans_only.sql`

**Intent**: Redefine `get_plan_recency` so the history plan (`hp`) must be saved. Header comment states the rule, why (first user feedback), that a never-saved or too-late-to-edit plan yields no notes, that the plan being annotated may itself be the history source once saved, and that no backfill is needed.

**Contract**: Same signature `get_plan_recency(p_plan_id uuid) returns table (option_id uuid, last_planned_on date)`, `language sql stable security invoker set search_path = ''`; only the extra condition `hp.saved_at is not null` is added; privileges re-granted as in the previous migration (revoke from public/anon, grant to authenticated). "Planned" is now: `is_chosen` option of a plan with `saved_at` not null.

#### 2. pgTAP test

**File**: `supabase/tests/get_plan_recency.test.sql`

**Intent**: Pin the new rule. Existing fixtures get `saved_at` on the plans that should count; add cases for plans that must not.

**Contract**: Header comment updated ("planned" = chosen in a saved plan). Cases, adjusting `plan(n)`:
- A never-saved earlier plan (`saved_at null`) with an otherwise matching chosen meal gives no note.
- An earlier plan whose week has already started (too late to edit) and was never saved gives no note.
- Earlier days of the annotated plan itself give a note only when that plan has `saved_at` set, and none while it is null.
- Saving a previously unsaved history plan (update `saved_at`) makes its meals count.
- The existing cases (other provider, other user via RLS, swapped slot, offered-only options) still hold with the saved fixtures.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- pgTAP suite passes, including the updated recency test: `npx supabase test db`
- Lint and type check pass: `npm run lint && npx astro check`
- Unit tests pass: `npm test`

#### Manual Verification:

- In local Studio, `select * from get_plan_recency(<plan id>)` for a user with one saved and one unsaved earlier plan returns rows only for the saved one

**Implementation Note**: After this phase and its automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Smoke script, README and roadmap

### Overview

Bring the HTTP-level smoke and the docs in line with the rule; mark the roadmap item.

### Changes Required:

#### 1. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: The history behind the recency note can no longer be the never-saved current week. The upcoming week the script already swaps and saves becomes the history, and a later week annotated against it carries the note. The current-week plan stays, but now proves the negative rule.

**Contract**:
- After the current-week and upcoming-week deliveries, the "Next week" tab shows no `In your plan` text (replaces the old positive "recency notes on the upcoming week" step); "This week" still has none.
- The existing swap step saves the upcoming week; later in the run (after the steps that rely on "Next week" being that upcoming week, since the tab shows the latest future plan), deliver a week 7 days after it with the same meals and assert its tab contains `In your plan 7 days earlier (`, with `recencyNote`/`gap` computed from the two Mondays instead of current week vs next week. Update the `upcomingMonday` doc comment and the header comment that describe the 14-day gap.
- Assert the negative for the later week's slot whose recommended meal was swapped away in the saved week (no note), so a regression to "recommended counts" fails.
- The smoke user is the same one used by the later password-reset steps ("re-delivered week" checks): adjust their expectations only if the extra delivered week changes which plan "Next week" shows.

#### 2. README

**File**: `README.md`

**Intent**: Describe the new rule and keep the dev walkthrough runnable.

**Contract**: In "Swapping and saving the upcoming plan", replace "Recency notes count the meals the user chose, not the ones MO recommended" with the saved-plans rule (chosen meals of saved plans only; unsaved plans, plans delivered too late to edit and the upcoming plan's own earlier days until saved give no notes; saving makes a plan count at once). Walkthrough step 4 (second delivery) changes to: deliver an upcoming week, save it in step 5's way, then deliver a later week to see the note; step 5's "Choosing a meal also chosen on an earlier day" sentence is reconciled with "counts once the plan is saved". The smoke section's description of the recency checks is updated to match the script. No new sections.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: `/10x-plan` flips S-11 to `planning` in the At a glance table and its body, and bumps `updated` (done at plan-write time, forward-only). `done` is set later via `/10x-roadmap` after merge.

### Success Criteria:

#### Automated Verification:

- Build and checks pass: `npm run lint && npx astro check && npm run build`
- Smoke passes against the production preview on port 4322 with the local Supabase stack: `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=<token> SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run smoke`

#### Manual Verification:

- README walkthrough, followed on a local stack: the later week shows a recency note only after the earlier week is saved, and a never-saved earlier week gives none
- Saving an unsaved upcoming plan on the dashboard makes notes for its own repeated meals appear without reload

**Implementation Note**: Production needs `npx supabase db push` after CI is green and before merging (README "Production setup").

---

## Testing Strategy

### Unit Tests:

- No new unit tests: `formatRecency` and the services are unchanged.

### Integration Tests:

- pgTAP `get_plan_recency.test.sql` covers the rule, including unsaved/too-late plans and the saved-later transition.
- Smoke covers it over HTTP: no note from an unsaved week, note after save, no note for a swapped-away recommendation.

### Manual Testing Steps:

1. Deliver two weeks as in the README walkthrough without saving the earlier one: no notes.
2. Save the earlier week (swap or "Keep as recommended"), deliver the later: notes appear with the right day gap.
3. On an unsaved upcoming plan with a meal repeated on two days, no note on the later day; after saving, the note appears.

## Performance Considerations

One extra equality filter on a primary-key-joined table; no index change.

## Migration Notes

Applied to production with `npx supabase db push` before merge. Behavior changes for existing users at once: history from unsaved plans stops producing notes. That is the intent.

## References

- Issue: #78; roadmap `context/foundation/roadmap.md` § S-11; PRD FR-008 update 2026-10-06
- Current function: `supabase/migrations/20261003120000_plan_choices.sql` (get_plan_recency)
- Test to extend: `supabase/tests/get_plan_recency.test.sql`
- Callers (unchanged): `src/lib/services/plans.ts:81`, `src/lib/plan-save.ts:88`, `src/pages/dashboard.astro:46`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recency counts saved plans only

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset` — c02ef72
- [x] 1.2 pgTAP suite passes, including the updated recency test: `npx supabase test db` — c02ef72
- [x] 1.3 Lint and type check pass: `npm run lint && npx astro check` — c02ef72
- [x] 1.4 Unit tests pass: `npm test` — c02ef72

#### Manual

- [x] 1.5 In local Studio, `get_plan_recency` for a user with one saved and one unsaved earlier plan returns rows only for the saved one — c02ef72

### Phase 2: Smoke script, README and roadmap

#### Automated

- [x] 2.1 Build and checks pass: `npm run lint && npx astro check && npm run build`
- [x] 2.2 Smoke passes against the production preview on port 4322 with the local Supabase stack

#### Manual

- [x] 2.3 README walkthrough on a local stack: later week shows a note only after the earlier week is saved
- [x] 2.4 Saving an unsaved upcoming plan makes notes for its own repeated meals appear without reload
