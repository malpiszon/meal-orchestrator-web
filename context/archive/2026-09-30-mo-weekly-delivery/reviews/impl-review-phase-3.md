<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: MO Weekly Delivery (S-01)

- **Plan**: context/changes/mo-weekly-delivery/plan.md
- **Scope**: Phase 3 of 4
- **Reviewed phases**: 3
- **Date**: 2026-10-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

Notes:

- **Plan drift:** none. Every planned item matches.
  - `todayInWarsaw` returns the date in Europe/Warsaw. Every DST test value was hand-checked, on both sides of the 2026-10-25 01:00 UTC switch.
  - `groupPlanOptions` orders days by date and slots by `MEAL_TYPES`.
  - `getUpcomingPlan` makes one RLS-bound select (`week_start > today`, newest first, limit 1).
  - The dashboard shows the week range, day labels, meal-slot labels, the recommended option with `score/10` and justifications, and a `<details>` "Other options". The waiting card and sign-out are present.
- **Small additions the plan doesn't name, all benign:**
  - An error card when the query fails.
  - A fallback when no option is flagged as recommended.
  - Skipping unknown meal types.
  - Label helpers (`mealTypeLabel`, `formatDayLabel`, `formatWeekRange`).
  - The "(N)" count in the "Other options" summary.
  - The page heading "Your meals".
  - The select leaves out `raw_payload` and `mo_run_id`.
- **Verified correct:**
  - Reads go through the cookie client only, so RLS applies, and `/dashboard` is still in `PROTECTED_ROUTES`.
  - No `set:html`, and no error details reach the page.
  - Date labels are UTC-safe, and the date formatters are built once at module level.
  - One round trip; no N+1 queries.
  - The heading hierarchy runs h1 → h4.
  - The CLAUDE.md styling rules are respected: tokens only, layout-only `className` on shadcn components, no `asChild` in `.astro`.
- **Not raised as findings:**
  - `badge.tsx`'s `destructive` variant uses `text-white`. That's unmodified shadcn output, the same as `button.tsx`, and that variant isn't used.
  - `plan_meal_options(*)` fetches a few columns the page doesn't render. The cost is negligible.
- **Automated checks:** passed at commit 0f93eae: `npm test` (36), lint, `astro check`, build, and the deliberate-break checks (Warsaw timezone and tie order).

## Findings

### F1 — A failed plan query leaves no trace in the logs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:20-21
- **Detail**: `catch { loadFailed = true; }` discards the error. `getUpcomingPlan` builds a detailed message (`weekly_plans query failed: <code> <message>`) that nobody ever sees. A production RLS or schema failure would show users "Couldn't load your plan" and leave nothing in Workers Logs. The delivery route logs its failures (`src/pages/api/mo/deliveries.ts`). `no-console` is `warn` for pages, so logging needs the same eslint override the delivery route got.
- **Fix**: Log the error message (code and message only, no user data) with `console.error` in the catch, and add `src/pages/dashboard.astro` to the eslint `no-console: off` override for the Worker.
- **Decision**: FIXED — catch logs `dashboard plan load failed: <code> <message>` via console.error; dashboard.astro added to the eslint no-console override

### F2 — The tie test can't catch a broken "recommended" lookup

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/plans.test.ts:79-86
- **Detail**: In this test the two options tie at score 9, and the one flagged `is_recommended` is also index 0, which the fallback (highest score, then lowest index) picks anyway. Deleting `.find((o) => o.is_recommended)` from `groupPlanOptions` would leave the test green, so nothing proves the page shows the stored recommendation (confirmed by reading the test).
- **Fix**: Put the flag on the tied option with the higher index (index 1), and expect `recommended.variant_index === 1` and `others` to equal `[0]`.
- **Decision**: FIXED — flag on the tied index-1 option, expects it recommended (break-check: test goes red when the is_recommended lookup is removed)

### F3 — Score `aria-label` on a plain span is ignored by screen readers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/plan/MealSlot.astro:18, 37
- **Detail**: Badge renders a `<span>` with no role. ARIA 1.2 doesn't allow naming generic elements, so screen readers usually ignore `aria-label` there and read "8/10".
- **Fix**: Drop the `aria-label` and add visually hidden text: `{score}/10<span class="sr-only"> score</span>`.
- **Decision**: FIXED — aria-label replaced with `<span class="sr-only"> score</span>` on both badges

### F4 — A plan with no displayable meals shows only a bare heading

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/plan/WeekPlan.astro:12, 22
- **Detail**: If `groupPlanOptions` returns no days, the week heading renders with nothing under it. The Phase 2 fixes require at least one day, meal and option, so in practice only rows with unknown meal types could trigger this.
- **Fix**: When `days.length === 0`, render a short "This week's plan has no meals to show." line under the heading.
- **Decision**: FIXED — "This week's plan has no meals to show." when grouping yields no days

### F5 — Test title claims runtime-timezone independence it doesn't prove

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/plans.test.ts:116
- **Detail**: The test is titled "independent of the runtime timezone" but runs only in the host's timezone. The code itself is correct (`timeZone: "UTC"`).
- **Fix**: Set `env: { TZ: "Pacific/Kiritimati" }` (UTC+14) in `vitest.config.ts`, so every run happens in a timezone where a wrong UTC conversion would shift the date. Production on Workers is UTC.
- **Decision**: FIXED (adapted) — Vitest runs with `TZ=Pacific/Honolulu` (UTC−10, not UTC+14: only a negative offset moves UTC midnight to the previous day); the test asserts the offset (break-check: label test goes red when `timeZone: "UTC"` is removed from the day formatter)

### F6 — No explicit `user_id` filter as defence in depth

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/plans.ts:9-23
- **Detail**: Isolation rests entirely on RLS. RLS was verified in the Phase 1 review, and the plan allows this, but it also calls an explicit filter "fine".
- **Fix**: Pass the user's id to `getUpcomingPlan(supabase, userId, today)` and add `.eq("user_id", userId)`.
- **Decision**: FIXED — `getUpcomingPlan(supabase, userId, today)` adds `.eq("user_id", userId)`; the dashboard only queries when `user` is set
