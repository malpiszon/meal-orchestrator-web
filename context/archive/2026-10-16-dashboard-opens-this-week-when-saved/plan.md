# Dashboard Opens "This week" Once Next Week Is Saved Implementation Plan

## Overview

Roadmap item S-12 (issue #168, MS-12). The dashboard picks its default tab from the saved state of next week: once the user has saved next week (a swap or "Keep these picks"), `/dashboard` opens on "This week", where they rate what they ate. While next week is unsaved, or when there is no plan for this week, it still opens on "Next week". The other tab stays one tap away.

## Current State Analysis

- `src/pages/dashboard.astro:129` renders `<PlanTabs client:load defaultTab={upcomingPlan ? "upcoming" : "current"}>`: any upcoming plan opens "Next week", saved or not. So from Wednesday on, a user who chose their meals on Tuesday still lands on "Next week" and has to tap over to rate.
- Both plans are already loaded with `saved_at` (`src/lib/services/plans.ts:9`, `WeeklyPlan.saved_at` in `src/types.ts:67`); no new query or migration is needed.
- `PlanTabs.tsx` takes `defaultTab` as Radix `defaultValue`, so the open tab is in the server HTML (`aria-selected`, `data-state`) before hydration, and only the initial render uses it: a save on the open page doesn't switch tabs (the decided behaviour).
- The `PlanTab` type (`"current" | "upcoming"`) is declared in `src/components/plan/PlanTabs.tsx:4`.
- `tests/e2e/critical-journey.spec.ts` always selects a tab with its local `openTab` helper before acting, so the new default doesn't break it; it never asserts which tab opened. `tests/e2e/seed.spec.ts:10-13` expects a radio to be visible without selecting a tab, which only holds while the seed user's next week opens by default (it is never saved today, but a saved one on the shared local stack would hide the radios).
- `scripts/smoke.mjs` reads both force-mounted panels from the HTML and never checks which is active: unaffected.
- Docs that state the old rule: `docs/api.md` § "Weeks on the dashboard and in history" (no default-tab rule yet) and `docs/dev-walkthrough.md` step 4 ("Next week" (open by default)) and step 5 (reload after a swap).

## Desired End State

`/dashboard` with both tabs opens:

| Upcoming plan | Saved (`saved_at`) | Current plan | Opens     |
| ------------- | ------------------ | ------------ | --------- |
| none          | —                  | yes          | This week |
| yes           | no                 | yes or no    | Next week |
| yes           | yes                | yes          | This week |
| yes           | yes                | no           | Next week |

(With neither plan the page shows "No upcoming plan yet" without tabs, unchanged.) A re-delivered week that stays saved keeps opening "This week"; the tab follows the saved state alone. The rule is a pure helper with unit tests, the e2e journey checks both the unsaved and the saved default in a real browser, and `docs/api.md` describes it.

### Key Discoveries:

- `src/pages/dashboard.astro:129` — the only place the default is decided.
- `src/lib/plans.ts` holds the page's pure plan helpers, unit-tested in `src/lib/plans.test.ts` (one `describe` per helper).
- Resolved on #168 (user, 2026-10-15): the open page stays on "Next week" after a save (every swap saves, the user can keep swapping); a re-sent saved week has no special case.
- `tests/e2e/critical-journey.spec.ts:26` `openTab` retries the click until hydrated; the default-tab check needs no click, as `aria-selected` is server-rendered.

## What We're NOT Doing

- No switch to "This week" right after a save on the open page (decided on #168).
- No special case for a re-delivered saved week (decided on #168).
- No migration, query or API change; no change to `/history/<id>`.
- No remembering the last tab the user picked (cookie, URL parameter or storage).
- No new marker on the "Next week" tab showing that it is saved.
- No smoke-test assertion on the active panel (unit + e2e cover the rule; decided in planning).

## Implementation Approach

Move the rule out of the template into a pure `defaultPlanTab` helper next to the other plan helpers, so every row of the table above is a cheap unit case, and the page only wires it in. Then pin the rendered behaviour with two assertions in the existing e2e journey, which already reaches both states (unsaved after the invitation, saved after signing in again), and make the seed spec independent of the default.

## Phase 1: Default-tab rule

### Overview

The dashboard opens "This week" when next week is saved and this week has a plan; the rule is unit-tested and documented.

### Changes Required:

#### 1. Rule helper

**File**: `src/lib/plans.ts`, `src/types.ts`, `src/components/plan/PlanTabs.tsx`

**Intent**: Add a pure helper that decides which tab the dashboard opens, and move the `PlanTab` type to the shared types so `src/lib` doesn't import from a component.

**Contract**: `defaultPlanTab(current: Pick<WeeklyPlan,"id"> | null, upcoming: Pick<WeeklyPlan,"saved_at"> | null): PlanTab` (exact parameter shapes up to the implementer, as long as only presence and `saved_at` matter) returns `"upcoming"` when there is an upcoming plan and either it is not saved (`saved_at === null`) or there is no current plan; otherwise `"current"`. `PlanTab` is exported from `src/types.ts`; `PlanTabs.tsx` imports it from there (it may re-export it).

#### 2. Unit tests

**File**: `src/lib/plans.test.ts`

**Intent**: One `describe("defaultPlanTab")` covering each row of the Desired End State table, including the boundary cases "saved upcoming, no current plan → Next week" and "no upcoming plan → This week".

**Contract**: Vitest cases only; no fixtures beyond minimal plan objects.

#### 3. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Pass `defaultPlanTab(currentPlan, upcomingPlan)` to `PlanTabs` instead of the inline ternary, with a short comment on why (saving next week means choosing is done; rating happens on "This week").

**Contract**: `<PlanTabs client:load defaultTab={…}>` at `dashboard.astro:129`; nothing else on the page changes.

#### 4. Docs

**File**: `docs/api.md`, `docs/dev-walkthrough.md`

**Intent**: State the default-tab rule where the dashboard's weeks are described, and keep the walkthrough's steps true.

**Contract**: `docs/api.md` § "Weeks on the dashboard and in history" gains a bullet: the dashboard opens "This week" once next week is saved and this week has a plan, otherwise "Next week" when there is one; the choice is made when the page opens, so a save on the open page stays on "Next week", and a re-delivered saved week (it stays saved) still opens "This week". `docs/dev-walkthrough.md` step 4 keeps "(open by default)" for the unsaved week; step 5 notes that after the swap a reload opens "This week", and the swapped option is checked in "Next week".

### Success Criteria:

#### Automated Verification:

- `defaultPlanTab` unit tests pass: `npx vitest run src/lib/plans.test.ts`
- Whole unit suite passes: `npm test`
- Lint and types pass: `npm run lint` and `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- On a preview at port 4325 (`ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4325`), with this week and an unsaved next week delivered (dev walkthrough steps 1–4), `/dashboard` opens "Next week"; after a swap the page stays on "Next week", and a reload opens "This week" with the swap kept in "Next week"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: E2E coverage

### Overview

The browser journey proves the page opens "Next week" while next week is unsaved and "This week" once it is saved; the seed spec no longer depends on the default tab.

### Changes Required:

#### 1. Shared tab helper

**File**: `tests/e2e/support/tabs.ts` (new), `tests/e2e/critical-journey.spec.ts`

**Intent**: Move `openTab` from the journey spec into `support/` so the seed spec can use it too.

**Contract**: `openTab(page, name: "This week" | "Next week"): Promise<void>`, unchanged behaviour (click retried until `aria-selected="true"`).

#### 2. Default-tab assertions in the journey

**File**: `tests/e2e/critical-journey.spec.ts`

**Intent**: Assert the default before any tab click: after "setting a password lands on the dashboard" (both weeks delivered, next week unsaved) the "Next week" tab is selected; in "signing in again with the new password" (next week saved by the keep and swap steps) the "This week" tab is selected. Update the header comment to name the default tab among what it asserts.

**Contract**: `expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true")`, asserted before the first `openTab` call of the following step; no click, as the attribute is server-rendered.

#### 3. Seed spec independent of the default

**File**: `tests/e2e/seed.spec.ts`

**Intent**: Select "Next week" with `openTab` before expecting a radio (after the first load and after the reload), so a saved next week for the seed user on the shared local stack can't hide the radios.

**Contract**: Same assertions as today, preceded by `openTab(page, "Next week")`.

### Success Criteria:

#### Automated Verification:

- E2E suite passes on port 4325: `E2E_PORT=4325 npm run test:e2e`
- Lint and types pass: `npm run lint` and `npx astro check`

#### Manual Verification:

- The CI `e2e` job is green on the PR

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `defaultPlanTab`: no upcoming plan → `"current"`; unsaved upcoming with and without a current plan → `"upcoming"`; saved upcoming with a current plan → `"current"`; saved upcoming without a current plan → `"upcoming"`.

### Integration Tests:

- E2E journey: unsaved next week opens "Next week" after the invitation; the same user, with next week saved, opens "This week" after signing in again.

### Manual Testing Steps:

1. Follow `docs/dev-walkthrough.md` steps 1–4 against the preview on port 4325; `/dashboard` opens "Next week".
2. Swap a meal; the page stays on "Next week".
3. Reload; the dashboard opens "This week", and "Next week" still shows the swap.

## Performance Considerations

None: the rule reads data the page already loads.

## Migration Notes

None. Existing saved upcoming plans start opening "This week" on deploy, which is the intended change.

## References

- Roadmap: `context/foundation/roadmap.md` § S-12; issue [#168](https://github.com/malpiszon/meal-orchestrator-web/issues/168) (unknowns resolved in its comments)
- Current default: `src/pages/dashboard.astro:129`; tabs island: `src/components/plan/PlanTabs.tsx`
- E2E journey: `tests/e2e/critical-journey.spec.ts`; seed: `tests/e2e/seed.spec.ts`
- Phase sub-issues: Phase 1 #171, Phase 2 #172

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Default-tab rule

#### Automated

- [x] 1.1 `defaultPlanTab` unit tests pass: `npx vitest run src/lib/plans.test.ts` — 2be9822
- [x] 1.2 Whole unit suite passes: `npm test` — 2be9822
- [x] 1.3 Lint and types pass: `npm run lint` and `npx astro check` — 2be9822
- [x] 1.4 Build succeeds: `npm run build` — 2be9822

#### Manual

- [x] 1.5 Preview on 4325: unsaved next week opens "Next week", a swap stays there, a reload opens "This week" with the swap kept — 2be9822

### Phase 2: E2E coverage

#### Automated

- [x] 2.1 E2E suite passes on port 4325: `E2E_PORT=4325 npm run test:e2e` — 3d9334f
- [x] 2.2 Lint and types pass: `npm run lint` and `npx astro check` — 3d9334f

#### Manual

- [x] 2.3 The CI `e2e` job is green on the PR
