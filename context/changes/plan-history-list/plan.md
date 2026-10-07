# Plan history list Implementation Plan

## Overview

S-07 (FR-012, nice-to-have): the signed-in user can browse their past plans. `/history` lists every week that has ended, newest first, each marked "Saved" or "Not saved". Each entry links to `/history/<plan id>`, which renders that week with the existing `WeekPlan` component: the chosen meal of every slot up front, the other options collapsed. The PRD scopes this to a simple chronological list, with no filtering or search.

## Current State Analysis

- The dashboard shows only two weeks: "This week" (`getCurrentPlan`, `week_start` in `(today − 7, today]`) and "Next week" (`getUpcomingPlan`, `week_start > today`), both judged in Europe/Warsaw (`src/lib/services/plans.ts:16-66`, `src/pages/dashboard.astro:31-37`). Older plans are stored but nothing shows them.
- RLS already limits `weekly_plans` and `plan_meal_options` reads to the owner (`supabase/migrations/20261001120000_weekly_plans.sql:41-47`), so no migration is needed.
- `saved_at` records whether and when the user saved a plan (`src/types.ts`, `WeeklyPlan.saved_at`). In a never-saved plan, `is_chosen` is still MO's recommendation.
- `WeekPlan.astro` takes a `plan`, an eyebrow `label` and optional `recency`. `MealSlot.astro` shows the chosen option with its score and justifications, and the others under `<details>` "Other options (N)" (`src/components/plan/MealSlot.astro:24-65`).

## Desired End State

- A "History" link in the dashboard header opens `/history`.
- `/history` lists the user's plans with `week_start ≤ today − 7` (Warsaw), newest first. Each row shows the week range (`formatWeekRange`) and a "Saved" or "Not saved" badge, and links to its week page. With no past plans it shows "No past plans yet".
- `/history/<id>` renders that past week with `WeekPlan`, with no recency notes. Its eyebrow reads "Saved <time>" or "Not saved: MO's recommendation", plus a link back to `/history`. An id that is malformed, unknown, someone else's, or of the current or upcoming week answers 404.
- Anonymous visitors to either page are redirected to `/auth/signin`.

### Key Discoveries:

- `getCurrentPlan`'s lower bound is `week_start > today − 7` (`src/lib/services/plans.ts:55-56`). History uses the complement, `week_start ≤ today − 7`, so a week appears either on the dashboard or in history, never both, and moves to history the Monday after it ends.
- `PROTECTED_ROUTES` matches by `startsWith` (`src/middleware.ts:4,28`), so adding `"/history"` covers `/history/<id>` too.
- The service conventions to copy: the user's cookie client, `.eq("user_id", userId)` as defence in depth, `withPgrst303Retry`, and errors rethrown as `"<what> failed: <code> <message>"` (`src/lib/services/plans.ts:21-36`).
- CLAUDE.md: no `asChild` in `.astro` files (use `buttonVariants({ variant })` on `<a>`), design tokens only, and `cn()` for class merging.

## What We're NOT Doing

- No filtering, search or pagination (FR-012 is scoped to a simple list; a small user base gets ~52 rows a year, and the list query loads no options).
- No recency notes or ratings on history pages (ratings are S-08).
- No "chosen meals only" variant of `WeekPlan`: it is reused as is.
- The in-progress week is not listed; it stays on the dashboard's "This week" tab.
- Never-saved weeks are not hidden; they are listed and marked "Not saved".
- No migration, no API route, no styling pass beyond existing tokens and components.

## Implementation Approach

Read-only server rendering, the same as the dashboard: two new service functions on the user's RLS-bound client, two Astro pages and one pure label helper. `WeekPlan` is reused unchanged; the saved status goes in its existing `label` prop.

## Phase 1: History pages

### Overview

Everything user-visible: services, label helper, the two pages, the route protection and the dashboard link.

### Changes Required:

#### 1. Past-plan services

**File**: `src/lib/services/plans.ts`

**Intent**: Load the list of past weeks (without options) and one past week (with options) for the signed-in user, following `getCurrentPlan`'s conventions.

**Contract**:
- `getPastPlans(supabase, userId, today): Promise<PastPlanSummary[]>` selects `id, week_start, week_end, saved_at` with `user_id = userId` and `week_start ≤ addDays(today, -7)`, ordered by `week_start` descending. It returns `[]` when there are none and throws on a query error.
- `getPastPlan(supabase, userId, planId, today): Promise<WeeklyPlan | null>` uses `PLAN_SELECT`, `id = planId`, `user_id = userId` and the same `week_start` bound, with `maybeSingle`. It returns `null` when no row matches, which covers foreign, current and upcoming plans.
- Both use `withPgrst303Retry`.
- `PastPlanSummary` (`id`, `week_start`, `week_end`, `saved_at`) is added to `src/types.ts`.

#### 2. Saved-status label

**File**: `src/lib/plans.ts` (+ `src/lib/plans.test.ts`)

**Intent**: One wording for the week page eyebrow, unit-tested.

**Contract**: `formatPlanSavedStatus(savedAt: string | null): string` returns `"Saved " + formatSavedAt(savedAt)` when saved, else `"Not saved: MO's recommendation"`.

#### 3. History list page

**File**: `src/pages/history/index.astro`

**Intent**: The chronological list, shaped like the dashboard page (same `Layout`, `main` container, header).

**Contract**:
- The page loads with `getPastPlans(createClient(...), user.id, todayInWarsaw(new Date()))`. A failed load logs `history load failed: …` (code and message only) and shows a "Couldn't load your history" card, like the dashboard's.
- The header holds an `h1` "Past plans" and a back link to `/dashboard` (`<a class={buttonVariants({ variant: "outline", size: "sm" })}>`).
- Each plan is a list item whose link text is `formatWeekRange(...)`, pointing to `/history/<id>`, with a `Badge` "Saved" (default variant) or "Not saved" (outline variant).
- With no past plans, it shows a `Card` reading "No past plans yet", with a short description that weeks show up here after they end.

#### 4. Week page

**File**: `src/pages/history/[id].astro`

**Intent**: One past week, reusing `WeekPlan`.

**Contract**:
- `Astro.params.id` is checked with `z.string().uuid()`. If it isn't a uuid, or `getPastPlan` returns `null`, the page responds with status 404 and a "Plan not found" card linking back to `/history`, without querying Postgres with the malformed id.
- Otherwise it renders `<WeekPlan plan={plan} label={formatPlanSavedStatus(plan.saved_at)} />` (no `recency`) under a back link to `/history`.
- A load error is handled like the list page's.

#### 5. Route protection and entry point

**Files**: `src/middleware.ts`, `src/pages/dashboard.astro`

**Intent**: History requires sign-in and can be reached from the dashboard.

**Contract**:
- `PROTECTED_ROUTES` becomes `["/dashboard", "/history"]`.
- The dashboard header gets a "History" link (`buttonVariants({ variant: "outline", size: "sm" })` on `<a href="/history">`) next to "Sign out".

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including `formatPlanSavedStatus` for saved and never-saved: `npm test`
- Lint passes: `npm run lint`
- Type and Astro checks pass: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- On local dev with a past-week delivery, `/history` lists it with "Not saved", and its week page shows the chosen meals with "Other options" collapsed and the eyebrow "Not saved: MO's recommendation"
- The dashboard's "History" link and both back links work, in light and dark mode and at phone width
- `/history/<upcoming plan id>` and `/history/abc` show "Plan not found" with status 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Smoke test, README and roadmap

### Overview

Guard the pages in the smoke script (so CI covers them) and document them.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove protection, the empty state, listing, the week page and the 404 boundary over HTTP.

**Contract**: new steps, in this order relative to the existing ones:
- With the anonymous steps: "history redirects anonymous user": `GET /history` → 302 to `/auth/signin`.
- After sign-in, before any past delivery: "history shows no past plans yet": 200 containing "No past plans yet".
- "past-week delivery for the signed-in user is stored": deliver the sample to the smoke user for the week starting `currentMonday()` − 7 days, and keep its `plan_id`.
- "history lists the past week as not saved": `/history` contains that week's `formatWeekRange` text (or its `/history/<plan_id>` href) and "Not saved".
- "history week page shows its meal": `/history/<plan_id>` → 200 with a recommended meal name of the sample and "Not saved: MO&#39;s recommendation" (or the escaped form Astro emits).
- "history hides the upcoming week": `/history/<upcoming plan_id>` → 404, using the `plan_id` from the existing upcoming-week delivery response.
- "history rejects a malformed id": `/history/not-a-uuid` → 404.

The past week is never saved, so by S-11's rule it adds no recency notes; existing recency assertions must still pass unchanged.

#### 2. README

**File**: `README.md`

**Intent**: Document the feature where the dashboard features are documented.

**Contract**:
- A short "Plan history" subsection after "Swapping and saving the upcoming plan": the routes, which weeks are listed (`week_start` ≤ today − 7, Europe/Warsaw), the Saved/Not saved marker and the 404 cases.
- A dev-walkthrough step: deliver a past week and open `/history`.
- The smoke-test paragraph names the new history checks.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Status sync handled by `/10x-implement`, which flips S-07 to `in-progress`; nothing else changes.

**Contract**: S-07 `Status` only.

### Success Criteria:

#### Automated Verification:

- Smoke passes against a local preview on :4322 with local Supabase: `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run smoke`
- Lint and format checks pass on the changed files: `npm run lint`
- CI `ci` and `smoke` jobs are green on the PR

#### Manual Verification:

- The README's new walkthrough step, followed on local dev, shows the past week in `/history`

---

## Testing Strategy

### Unit Tests:

- `formatPlanSavedStatus`: a saved timestamp renders "Saved Fri 9 Oct, 18:42"-style text, and `null` renders "Not saved: MO's recommendation".

### Integration Tests:

- The smoke steps above, against the Cloudflare-runtime preview and local Supabase (RLS, the Warsaw date boundary and the uuid guard, end to end).

### Manual Testing Steps:

1. Deliver a past week (README walkthrough), sign in and open `/history` from the dashboard.
2. Open the week, expand "Other options" and check the eyebrow.
3. Try `/history/<upcoming id>` and `/history/abc`: both show "Plan not found".

## Performance Considerations

The list selects four columns of `weekly_plans` per user, with no option rows, so it stays light within the Workers free-plan CPU budget as history grows. The week page loads one week's options, the same as a dashboard tab.

## Migration Notes

None. There's no schema change and no production setup step.

## References

- Roadmap item: S-07, issue [#10](https://github.com/malpiszon/meal-orchestrator-web/issues/10)
- PRD: FR-011, FR-012, US-06 (`context/foundation/prd.md`)
- Boundary source: `src/lib/services/plans.ts:44-66` (`getCurrentPlan`)
- Reused view: `src/components/plan/WeekPlan.astro`, `src/components/plan/MealSlot.astro`
- Saved-only rule precedent: `context/archive/2026-10-07-recency-from-saved-plans/`
- Phase sub-issues: Phase 1 [#82](https://github.com/malpiszon/meal-orchestrator-web/issues/82), Phase 2 [#83](https://github.com/malpiszon/meal-orchestrator-web/issues/83) (blocked by #82)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: History pages

#### Automated

- [x] 1.1 Unit tests pass, including `formatPlanSavedStatus` for saved and never-saved: `npm test` — 0128d1f
- [x] 1.2 Lint passes: `npm run lint` — 0128d1f
- [x] 1.3 Type and Astro checks pass: `npx astro check` — 0128d1f
- [x] 1.4 Build succeeds: `npm run build` — 0128d1f

#### Manual

- [x] 1.5 On local dev with a past-week delivery, `/history` lists it with "Not saved", and its week page shows the chosen meals with "Other options" collapsed and the eyebrow "Not saved: MO's recommendation" — 0128d1f
- [x] 1.6 The dashboard's "History" link and both back links work, in light and dark mode and at phone width — 0128d1f
- [x] 1.7 `/history/<upcoming plan id>` and `/history/abc` show "Plan not found" with status 404 — 0128d1f

### Phase 2: Smoke test, README and roadmap

#### Automated

- [x] 2.1 Smoke passes against a local preview on :4322 with local Supabase: `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run smoke` — 29a489e
- [x] 2.2 Lint and format checks pass on the changed files: `npm run lint` — 29a489e
- [x] 2.3 CI `ci` and `smoke` jobs are green on the PR — 29a489e

#### Manual

- [x] 2.4 The README's new walkthrough step, followed on local dev, shows the past week in `/history` — 29a489e
