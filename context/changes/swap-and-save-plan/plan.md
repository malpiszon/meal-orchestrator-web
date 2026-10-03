# Swap and save the upcoming plan Implementation Plan

## Overview

S-03 (issue #7, FR-009, FR-010, US-01): the user can swap any meal of the upcoming week for another option from that week's menu, and every swap is saved at once. A plan nobody swapped can be confirmed as recommended. All of it is possible until the plan's first day (Europe/Warsaw); from then on Postgres rejects changes. The user's choice becomes what "planned" means for the recency notes (S-02 handoff).

## Current State Analysis

- Weekly plans are stored per user and week in `weekly_plans`, with every menu option in `plan_meal_options` (`supabase/migrations/20261001120000_weekly_plans.sql:6-33`). MO sends scores only; mo-web flags one option per (date, meal type) `is_recommended` at ingest: the highest score, with ties going to the lowest index (`src/lib/mo-delivery.ts:134-162`).
- Users can only read their own rows. `insert/update/delete` are revoked from `anon` and `authenticated`, and the only writer is the service-role `ingest_weekly_plan` (`20261001120000_weekly_plans.sql:41-54`; current body in `20261002170000_ingest_weekly_plan_email_index.sql`).
- Re-ingesting a week upserts the `weekly_plans` row and deletes and re-inserts all of its options (`20261002170000_ingest_weekly_plan_email_index.sql:35-66`). Anything stored on option rows is therefore reset by a re-sent week, which is what S-06/FR-017 require until FR-018 exists.
- `get_plan_recency` counts an earlier occurrence only when `h.is_recommended` (`supabase/migrations/20261002190000_plan_recency.sql:27`). Its header and the roadmap's S-02 handoff require S-03 to switch it to the user's choice. Its only index is `plan_meal_options_user_meal_date_idx (user_id, provider_meal_id, meal_date)`, which has no other reader.
- "Upcoming" is `week_start > todayInWarsaw()` (`src/lib/services/plans.ts:14-33`, `src/lib/plans.ts:24`). "This week" is the latest plan with `today - 7 < week_start <= today`.
- The dashboard is server-rendered Astro: `WeekPlan.astro` → `MealSlot.astro` shows the recommended option, with the others collapsed in a `<details>`. The only React island is `PlanTabs.tsx`, and the upcoming week is passed to it as a named slot (`src/pages/dashboard.astro:71-82`).
- `groupPlanOptions` sorts options by score descending, then `variant_index`, and picks the `is_recommended` one as the headline (`src/lib/plans.ts:45-75`). It is tested in `src/lib/plans.test.ts`.
- There are no user-facing write APIs yet. API routes follow `src/pages/api/mo/deliveries.ts` (`prerender = false`, JSON responses, code-and-message-only logging).
- Smoke (`scripts/smoke.mjs`) signs a user in, delivers the current and upcoming weeks, and checks the dashboard HTML. pgTAP tests live in `supabase/tests/`.

## Desired End State

On `/dashboard`, the "Next week" tab shows every option of every meal slot without expanding anything. Each option shows its score, recency note and justifications, and every option with the slot's top score carries a star badge, as in MO's email (a tie gives several stars). The chosen option of each slot is selected (initially the recommended one, `is_recommended`). Tapping another option saves it immediately: the selection moves, the recency notes of the week update, and the status line reads "Saved Fri 9 Oct, 18:42 · Editable until Sun 11 Oct". An unsaved plan reads "Not saved yet · Editable until Sun 11 Oct" and offers "Keep as recommended", which saves without swapping. From Monday 00:00 Europe/Warsaw, the plan is "This week": it shows the chosen meals in the compact layout, and any save attempt is answered 409 `plan_locked`. Recency notes everywhere count the user's chosen options, not the recommended ones.

Verified by: pgTAP tests (choice, confirmation, cut-off boundary, ownership, re-ingest reset, recency on choices), Vitest (grouping by choice, date/time labels), the smoke script (swap persists, dashboard reflects it, locked week rejected, anonymous rejected) and a manual phone-width walkthrough.

### Key Discoveries:

- Option rows are recreated on every re-delivery (`20261002170000_ingest_weekly_plan_email_index.sql:47`), so a choice flag on the row resets for free. `weekly_plans.saved_at` must be reset explicitly in the `on conflict` branch.
- The recency join already filters `h.user_id`, `h.provider_meal_id` and `h.meal_date`, so a partial index `where is_chosen` on the same columns serves the new predicate and replaces the old index.
- Swapping can change recency notes inside the same week (choosing X on Monday gives X on Wednesday "2 days earlier"), so a save must return the plan's fresh recency.
- `PlanTabs` receives the upcoming week as an Astro slot. A React island rendered inside that slot hydrates as its own island, so the editor does not have to be merged into `PlanTabs`.

## What We're NOT Doing

- No draft or unsaved state: every tap saves, and there is no "Save" button. "Keep as recommended" exists only while `saved_at` is null.
- No "reset all swaps" action. Tapping the recommended option in a slot undoes that slot's swap.
- No editing of "This week" or past plans, and no history view (S-07).
- No preserving of choices on re-delivery: a re-sent week resets choices and `saved_at` (S-06 tests it; FR-018 is parked).
- No smarter tie-break between equally scored options. All options are visible, ordered by score and then menu order, and every top-scored option gets the star, so a tie is visible instead of resolved. The initial choice stays S-01's first-listed rule (`is_recommended`).
- No per-user time zone: the cut-off is Warsaw midnight for everyone.
- No mirroring of the provider's own meal-change deadlines (PRD Non-Goals).
- No ratings (S-08).

## Implementation Approach

The choice lives on the option rows (`is_chosen`), next to MO's `is_recommended`, so recency, display and indexing read one boolean. The two writes go through `security definer` Postgres functions, not table grants. Each function checks that the caller owns the plan and that `week_start` is after today in Europe/Warsaw, so the cut-off cannot be bypassed from the client or a stale page. Thin, zod-validated API routes call the functions with the user's cookie-session client, then re-read the plan's recency through the existing security-invoker `get_plan_recency`. The "Next week" week becomes one React island that renders every option as a native radio input and saves on change.

## Critical Implementation Details

- **State sequencing:** in `choose_plan_option`, clear the slot's current choice before setting the new one, as two statements. The partial unique index on (plan, date, meal type) `where is_chosen` is checked row by row, so a single `update … set is_chosen = (id = p_option_id)` can fail on an intermediate row. Lock the plan row (`select … for update`) first, so concurrent taps on two devices serialize.
- **Timing & lifecycle:** the island keeps one save in flight at a time (inputs disabled while pending). Without that, two quick taps could resolve out of order and the UI would show a choice that differs from the database.
- **User experience spec:** use native radio inputs, one `fieldset` per slot with the meal-type label as `legend` and the option id as `value`, so the controls work on mobile, are keyboard-accessible, and carry a `checked` attribute in the server HTML that smoke can read.

## Phase 1: Database: choices, cut-off and recency

### Overview

Store the user's choice and the save time, add the two guarded write functions, keep ingest consistent, and switch recency to the choice. Everything is covered by pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261003120000_plan_choices.sql`

**Intent**: Add the user's choice per slot and the plan's save time, the write functions that enforce ownership and the Warsaw cut-off, the ingest update, and the recency switch. The header comment states the rules: one chosen option per slot, editable while `week_start > today` in Europe/Warsaw, re-delivery resets choices.

**Contract**:
- `plan_meal_options.is_chosen boolean not null default false`, backfilled `= is_recommended`. Partial unique index `plan_meal_options_one_chosen_per_slot (plan_id, meal_date, meal_type) where is_chosen`.
- `weekly_plans.saved_at timestamptz` (null = never saved).
- `ingest_weekly_plan`: same signature and body as `20261002170000`, except that options are inserted with `is_chosen = is_recommended` and the `on conflict` update sets `saved_at = null`. Keep the existing revoke/grant lines.
- `public.choose_plan_option(p_option_id uuid) returns timestamptz` (the new `saved_at`), `plpgsql security definer set search_path = ''`. It resolves the option's plan with `user_id = auth.uid()` and locks the plan row; if the option is missing or belongs to someone else it raises `errcode 'P0002', message 'not_found'`. If `week_start <= (now() at time zone 'Europe/Warsaw')::date` it raises `errcode '55000', message 'plan_locked'`. It then clears `is_chosen` in that slot, sets it on the option, and sets `saved_at = now()`.
- `public.confirm_plan(p_plan_id uuid) returns timestamptz`: same ownership, lock and cut-off checks, and sets `saved_at = now()` without touching choices.
- Both functions: `revoke execute … from public, anon`; `grant execute … to authenticated`.
- `get_plan_recency`: same signature and security invoker as before; the predicate `h.is_recommended` becomes `h.is_chosen`. Update its header comment.
- Drop `plan_meal_options_user_meal_date_idx` and create `plan_meal_options_chosen_history_idx (user_id, provider_meal_id, meal_date) where is_chosen`.

#### 2. pgTAP: choices and cut-off

**File**: `supabase/tests/plan_choices.test.sql`

**Intent**: Prove the write rules, using dates relative to `(now() at time zone 'Europe/Warsaw')::date` so the test never ages.

**Contract**: Fixtures cover two users, a plan of user A starting tomorrow (Warsaw), a plan of user A starting today (boundary), and a plan of user B. The test asserts:
- Privileges: `anon` cannot execute either function and `authenticated` can.
- As A: choosing an option in tomorrow's plan moves `is_chosen` within that slot only (other slots and days untouched), sets `saved_at`, and leaves exactly one chosen option in the slot. Choosing the recommended option again moves the choice back.
- As A: `confirm_plan` sets `saved_at` and changes no `is_chosen`.
- As A: both functions on the plan starting today raise `plan_locked`.
- As A: the functions on B's option or plan raise `not_found`, and B's rows are unchanged.
- As service role: re-ingesting the week through `ingest_weekly_plan` resets `saved_at` to null and `is_chosen` to `is_recommended`. A first ingest sets `is_chosen = is_recommended`.

#### 3. pgTAP: recency on choices

**File**: `supabase/tests/get_plan_recency.test.sql`

**Intent**: Switch the existing fixtures to the choice predicate and prove that a swap changes what counts.

**Contract**: The fixture inserts set `is_chosen` alongside `is_recommended`. A new case has an earlier slot where MO recommended X but the user chose Y: Y counts as planned there and X does not. Existing expectations keep their meaning, and the comments say "chosen" instead of "recommended". Update the header comment that mentions S-03.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly on a fresh local stack: `npx supabase db reset`
- pgTAP tests pass, including the new `plan_choices.test.sql` and the updated `get_plan_recency.test.sql`: `npx supabase test db`
- Existing unit tests still pass: `npm test`

#### Manual Verification:

- In Studio, existing local plans show `is_chosen` equal to `is_recommended` after the migration, and `saved_at` null

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Server: services and API

### Overview

Expose the two writes to the signed-in user, return what the UI needs after each save, and make the grouping and labels choice-aware.

### Changes Required:

#### 1. Types

**File**: `src/types.ts`

**Intent**: Carry the new columns through the read path.

**Contract**: `PlanMealOption.is_chosen: boolean`, `WeeklyPlan.saved_at: string | null`. `PlanSlot<T>` becomes `{ mealType, chosen: T, others: T[], options: T[], topScore: number }`: `chosen` is the headline for "This week", `options` lists all of them, best first, in a stable order for the editor, and `topScore` is the slot's highest score (the star goes on every option with that score, mirroring MO's email). `PLAN_SELECT` in `src/lib/services/plans.ts` adds `saved_at`.

#### 2. Pure helpers

**File**: `src/lib/plans.ts`, `src/lib/plans.test.ts`

**Intent**: Group by the user's choice, and format the status-line dates without ICU differences between Node and workerd.

**Contract**:
- `groupPlanOptions`: `GroupableOption` gains `is_chosen`. The `chosen` fallback order is `is_chosen` → `is_recommended` → best (score desc, index asc). `options` is the full sorted list. Rename `recommended` to `chosen` in the existing callers.
- `formatEditableUntil(weekStart)` returns the label for the day before `weekStart`, e.g. `2026-10-12` → "Sun 11 Oct", using the existing short weekday/month arrays.
- `formatSavedAt(isoTimestamp)` returns the Europe/Warsaw wall-clock time, e.g. `2026-10-09T16:42:00Z` → "Fri 9 Oct, 18:42". Use `Intl.DateTimeFormat` numeric `formatToParts` with `timeZone: "Europe/Warsaw"`, `hourCycle: "h23"` and the hand-built name arrays.
- Tests: the fallback order, `options` ordering independent of the choice, `topScore` on a slot with a tie, a DST-boundary `formatSavedAt` (summer +2 and winter +1), and `formatEditableUntil` across a month boundary.

#### 3. Services

**File**: `src/lib/services/plans.ts`

**Intent**: Wrap the RPCs in the same style as `getPlanRecency`, mapping Postgres errors to typed outcomes for the routes.

**Contract**: `choosePlanOption(supabase, optionId)` and `confirmPlan(supabase, planId)` return `{ savedAt: string }`. They throw a `PlanWriteError` with a `kind` of `"not_found" | "plan_locked" | "failed"`, detected from `P0002` / `55000` plus the message. A helper `getPlanIdForOption` is not needed: the route gets the plan id from the request body (below).

#### 4. API routes

**File**: `src/pages/api/plans/choose.ts`, `src/pages/api/plans/confirm.ts`

**Intent**: Cookie-session endpoints the island calls. Each one saves, then returns the saved time and the plan's refreshed recency so the island can update in place.

**Contract**:
- `export const prerender = false`, `POST` only, with JSON bodies validated by zod.
- `choose`: `{ planId: uuid, optionId: uuid }`. `confirm`: `{ planId: uuid }`.
- `planId` is used only to re-read recency after the save, through `getPlanRecency`, which is RLS-bound. The write function itself checks the option's real plan and owner.
- Responses: 200 `{ saved_at, recency: Record<optionId, "YYYY-MM-DD"> }`; 400 `invalid_request` (with zod issues); 401 `unauthorized` when `locals.user` is null; 404 `not_found`; 409 `plan_locked`; 503 `not_configured` when there is no Supabase client; 500 `save_failed`. If the save succeeds but the recency re-read fails, return 200 with `recency: null`: the save stands, and the island keeps its old notes.
- Logging follows `deliveries.ts`: step, code and message only.
- `/api/plans/` is not added to `PROTECTED_ROUTES`, because a redirect is wrong for a JSON client. The route returns 401 itself.

#### 5. Shared grouping callers

**File**: `src/components/plan/MealSlot.astro`, `src/components/plan/WeekPlan.astro`

**Intent**: "This week" shows the chosen meal as the headline. The layout is otherwise unchanged (compact, others collapsed).

**Contract**: `MealSlot` reads `meal.chosen` instead of `meal.recommended`. The rendered output for a plan without swaps is unchanged.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new grouping and label tests: `npm test`
- Lint passes: `npm run lint`
- Type check and build pass: `npx astro check && npm run build`

#### Manual Verification:

- With `npm run dev` and a signed-in walkthrough user (README), `curl` with the session cookie to `POST /api/plans/choose` returns 200 with `saved_at` and `recency`. The same request for the current week returns 409, a garbage body returns 400, and a request without a cookie returns 401

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dashboard: swap UI

### Overview

Replace the server-rendered "Next week" with an island that shows every option, saves on tap, and shows where the plan stands. Extend smoke and the docs.

### Changes Required:

#### 1. Upcoming week editor island

**File**: `src/components/plan/UpcomingWeekEditor.tsx`, `src/components/hooks/usePlanChoices.ts`

**Intent**: The editable "Next week". Every option of every slot is visible. Top-scored options carry a star, the user's choice is selected, and a tap saves through the API with an optimistic update.

**Contract**:
- Props (all serializable): `planId`, `weekLabel` (from `formatWeekRange`), `editableUntil` (from `formatEditableUntil`), `savedAtLabel: string | null` (from `formatSavedAt`), `days` (grouped `PlanDay` with each option's `id`, `name`, `score`, `justifications`, `is_recommended`, `is_chosen`, `meal_date`), `recency: Record<string, string>`.
- Per day: a shadcn `Card` with the day label. Per slot: a `fieldset` with the meal-type `legend`, then one native radio per option (`name` = slot key, `value` = option id), ordered by `options`. Each option shows its name, score `Badge`, a star `Badge variant="outline"` (lucide `Star` icon, no text, `sr-only` "Top score") on every option whose score equals the slot's `topScore`, its recency note (lucide `History` icon plus `formatRecency`), and its justifications. The selected option is highlighted with token classes through `cn()`; colour classes are never passed to a shadcn component's `className`.
- Status line above the days:
  - Unsaved: "Not saved yet · Editable until {editableUntil}" plus a "Keep as recommended" `Button`.
  - Saved: "Saved {savedAtLabel} · Editable until {editableUntil}".
  - The line has `aria-live="polite"` and shows "Saving…" while a request is pending.
- `usePlanChoices` holds the chosen id per slot, `savedAt` and `recency`, with one request in flight at a time (all radios and the button disabled while pending):
  - On 200 it applies `saved_at` (formatted client-side with `formatSavedAt`) and the new `recency` (when it is not `null`).
  - On error it reverts the slot and shows an inline `Alert`.
  - On 409 it shows "This plan has started and can't be changed anymore. Reload to see it as this week's plan." and disables all inputs.
- The status line and every option row stay readable at phone width (no horizontal scroll).

#### 2. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Render the editor for the upcoming plan inside the existing "upcoming" tab slot, and the unchanged `WeekPlan` for "This week".

**Contract**: When `upcomingPlan` exists, render `<UpcomingWeekEditor client:load … />` with the props built server-side: `groupPlanOptions`, `Object.fromEntries(upcomingRecency ?? [])`, and the formatted labels. `NoUpcomingPlan` and the load-failure card are unchanged. `WeekPlan.astro`'s `recency` prop stays for possible reuse, but the dashboard no longer passes it.

#### 3. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Prove the end-to-end path over HTTP against a real server and database.

**Contract**: New steps after the upcoming delivery:
1. "choose without session is rejected": `POST /api/plans/choose` with a well-formed body and no cookie returns 401.
2. "swap in upcoming week is saved": the user picks a non-recommended option of the upcoming plan, with the option id and plan id read from the dashboard HTML (radio `value` next to a known meal name from the sample). The request returns 200 with `saved_at`.
3. "dashboard shows the swap": the dashboard HTML has that radio `checked` and "Saved ".
4. "current week is locked": choosing an option of the current-week plan, whose id is read the same way from the "This week" panel, returns 409 `plan_locked`. This needs the "This week" panel to carry option ids, so `MealSlot.astro` adds a `data-option-id` attribute on each option.
5. "unknown option is not found" (review addendum, phase-2 F4): choosing a random well-formed `optionId` with the upcoming `planId` returns 404 `not_found`.
6. "invalid body is rejected" (review addendum, phase-2 F4): a non-JSON body with the session returns 400 `invalid_request`.

These steps run before the re-delivery step, which then also proves that the swap is reset ("Not saved yet" is back).

#### 4. Docs

**File**: `README.md`

**Intent**: Document the two routes and the cut-off, extend the dev walkthrough with "swap a meal, reload, see it saved", and list the new smoke steps.

**Contract**: New subsection "Swapping and saving the upcoming plan" under Supabase Configuration (routes, responses, the Warsaw cut-off). A walkthrough step 5. The Smoke test paragraph mentions the swap, lock and reset checks. The production timing note already covers pushing the new migration before merging.

### Success Criteria:

#### Automated Verification:

- Lint, unit tests, type check and build pass: `npm run lint && npm test && npx astro check && npm run build`
- Smoke passes against the production preview on port 4323, including the new swap, lock and reset steps: `npm run build && npm run preview -- --port 4323` then `BASE_URL=http://localhost:4323 MO_INGEST_TOKEN=… npm run smoke`
- pgTAP still passes: `npx supabase test db`

#### Manual Verification:

- At phone width (≈375 px), "Next week" shows every option of every slot without expanding anything, with the chosen option clearly selected and every top-scored option starred (several on a tie)
- Tapping another option saves it: the status line changes to "Saved …", and after a reload the choice is still selected
- Choosing the same meal on an earlier day of the week makes the later day's option show a fresh recency note without a reload
- "Keep as recommended" appears only on a never-saved plan and turns the status into "Saved …"
- After the upcoming week becomes "This week" (deliver a week whose Monday is today), the swapped meal is the headline there and no editing controls are shown
- Light and dark mode both look right, and the radios are keyboard-operable

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `groupPlanOptions`: chosen fallback (`is_chosen` → `is_recommended` → best), `options` order not depending on the choice, and `topScore` with tied options.
- `formatSavedAt` in summer and winter time, and `formatEditableUntil` across a month boundary.

### Integration Tests:

- pgTAP: choice moves within one slot only, confirm leaves choices, cut-off boundary (today locked, tomorrow open), cross-user `not_found`, re-ingest reset, privileges, recency counting the choice instead of the recommended option.
- Smoke: unauthenticated 401, swap persists and shows as `checked`, current week 409, re-delivery resets to "Not saved yet".

### Manual Testing Steps:

1. Follow the README walkthrough to sign in as a delivered user with an upcoming week.
2. On a phone-width window, swap Monday's lunch, reload, and confirm it is kept and the status reads "Saved …".
3. Swap Wednesday's lunch to the meal now chosen on Monday and see its note "In your plan 2 days earlier (Mon …)".
4. Deliver the same week again and confirm the plan is back to MO's recommended options with "Not saved yet".
5. Deliver a week starting today and confirm it shows as "This week" with no controls.

## Performance Considerations

Each tap is one RPC plus one recency RPC, both indexed: `choose_plan_option` touches one slot's rows, and recency uses the new partial index that holds only chosen rows. The island ships one React component tree for one week (≤ 7 days × ≤ 6 slots × ~3 options), which is well within the Workers CPU budget for SSR.

## Migration Notes

The migration backfills `is_chosen = is_recommended` for existing rows, so recency results are unchanged until a user swaps. Push it to production with `npx supabase db push` after the PR's CI is green and before merging, as README § "Production setup" requires: the deployed Worker selects `saved_at` and calls the new functions.

## References

- Roadmap: `context/foundation/roadmap.md` § S-03 (including the S-02 handoff)
- PRD: FR-009, FR-010, US-01, Business Logic date rules
- Prior plans: `context/archive/2026-09-30-mo-weekly-delivery/plan.md`, `context/archive/2026-10-02-recency-annotated-plan/plan.md`
- Schema: `supabase/migrations/20261001120000_weekly_plans.sql`, `20261002170000_ingest_weekly_plan_email_index.sql`, `20261002190000_plan_recency.sql`
- Grouping: `src/lib/plans.ts:45`; dashboard: `src/pages/dashboard.astro:71`
- Issue: #7; phase sub-issues: Phase 1 #40, Phase 2 #41, Phase 3 #43

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database: choices, cut-off and recency

#### Automated

- [x] 1.1 Migrations apply cleanly on a fresh local stack — 0126b95
- [x] 1.2 pgTAP tests pass, including plan_choices and updated get_plan_recency — 0126b95
- [x] 1.3 Existing unit tests still pass — 0126b95

#### Manual

- [x] 1.4 Existing local plans show is_chosen equal to is_recommended and saved_at null — 0126b95

### Phase 2: Server: services and API

#### Automated

- [x] 2.1 Unit tests pass, including grouping and label tests — 62939eb
- [x] 2.2 Lint passes — 62939eb
- [x] 2.3 Type check and build pass — 62939eb

#### Manual

- [x] 2.4 curl against choose returns 200 / 409 / 400 / 401 as specified — 62939eb

### Phase 3: Dashboard: swap UI

#### Automated

- [x] 3.1 Lint, unit tests, type check and build pass
- [x] 3.2 Smoke passes on port 4323 including swap, lock and reset steps
- [x] 3.3 pgTAP still passes

#### Manual

- [x] 3.4 Next week shows every option at phone width with choice selected and top-scored options starred
- [x] 3.5 Tapping an option saves it and survives a reload
- [x] 3.6 Same meal on an earlier day refreshes the later day's recency note without reload
- [x] 3.7 Keep as recommended appears only on a never-saved plan and marks it saved
- [x] 3.8 Swapped meal is the This week headline with no editing controls
- [x] 3.9 Light and dark mode look right and radios are keyboard-operable
