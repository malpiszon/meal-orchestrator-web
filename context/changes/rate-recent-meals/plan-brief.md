# Rate Recent Meals — Plan Brief

> Full plan: `context/changes/rate-recent-meals/plan.md`

## What & Why

Users rate the meal they had (each slot's chosen option) on a tongue-in-cheek five-face scale, 🤢 Never again · 😕 Meh · 😐 Fine · 🙂 Tasty · 😋 Chef's kiss, from the meal's own day until 7 days after it (S-08, FR-013, US-08, #11). The payoff: when MO recommends that meal again, the "Next week" editor shows how they liked it last time, next to the recency note, so the swap-or-keep decision is better informed.

## Starting Point

Plans, chosen options, saving and recency notes exist (S-01…S-07, S-11). "This week" and `/history/<id>` are static Astro views sharing `WeekPlan` → `MealSlot`; "Next week" is the React editor with recency notes. All writes go through `security definer` Postgres functions that check owner and Warsaw dates.

## Desired End State

On "This week", every chosen meal dated today or earlier has "How was it?" with five face buttons; tap saves, tapping the selected face clears. The previous week's history page shows the same controls on its meals still within 7 days; anything older shows the rating read-only. The "Next week" editor shows "Last rated 😋 Chef's kiss" on any option whose meal was rated on an earlier day.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Where to rate | Wherever a rateable meal is shown: "This week" + previous week's history page, controls only for `today-7 … today` | "This week only" would make Sunday's meals rateable only on Sunday and break US-08; both views share `MealSlot`, so it costs almost nothing. |
| Scale | Five faces 🤢 😕 😐 🙂 😋 with labels | One distinct glyph per value reads at a glance in a later-plan note, and it's playful. |
| Which meals | The chosen option only | Rates what was eaten; same notion of "the meal in the plan" as recency. |
| Editing | Change and clear within the window, saved on tap | Mistaps are fixable; matches the editor's tap-to-save. |
| Shown on later plans | The rating, whenever one exists, with or without a recency note | A rating proves they ate it, even if its plan was never saved (so recency is hidden). |
| "Latest" rating | From the most recent *rated* meal day before the option's date | The face refers to the last time they ate it; re-rating an older day doesn't override a newer one. |
| Window | `today-7 ≤ meal_date ≤ today`, Europe/Warsaw, inclusive | PRD's "own day or within the following 7 days". |
| Enforcement | Postgres `rate_meal` (owner, chosen, window); UI only hides controls | A stale page can't bypass it; 409 locks the controls. |

## Scope

**In scope:** `meal_ratings` table + RLS, `rate_meal` / `get_plan_ratings` functions, pgTAP tests, `POST /api/ratings`, rating island on week views, read-only ratings, rating note in the "Next week" editor, smoke steps, README.

**Out of scope:** rating non-chosen options, averages or rating history, ratings feeding recency, sending ratings to MO, tuning the 7-day window.

## Architecture / Approach

`meal_ratings(option_id PK → plan_meal_options, user_id, rating 1–5, rated_at)` holds one rating per meal occurrence; option rows of started weeks never change, so the reference is stable. Writes: island → `POST /api/ratings` (zod) → `rate_meal` RPC (security definer). Reads: own ratings are embedded in the plan query; the "Next week" editor gets `get_plan_ratings(plan)` (security invoker), loaded in parallel with recency and dropped silently on failure.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | Table, write/read functions, pgTAP tests | Off-by-one at the window ends; "latest" semantics |
| 2. API and helpers | `src/lib/ratings.ts`, service, `POST /api/ratings` | Error-code mapping drift from the plan routes |
| 3. Week views | Face island on "This week" + history, read-only ratings | Nested island inside the `PlanTabs` slot must hydrate |
| 4. Later plans, smoke, docs | Rating note in "Next week", smoke steps, README | Smoke picking a slot whose meal recurs in next week |

**Prerequisites:** S-02 (done); local Supabase for pgTAP and smoke. Migration push to production before merging.
**Estimated effort:** ~1–1.5 days across 4 phases.
