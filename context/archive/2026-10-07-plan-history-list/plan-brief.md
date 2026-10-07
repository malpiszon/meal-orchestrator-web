# Plan history list — Plan Brief

> Full plan: `context/changes/plan-history-list/plan.md`

## What & Why

S-07 (FR-012, nice-to-have): the user can browse their past plans as a simple chronological list, not only the two weeks on the dashboard. This completes the PRD's secondary success criterion ("browse their full history of past plans").

## Starting Point

The dashboard shows only "This week" and "Next week". Older plans are stored, with RLS limiting reads to their owner, but nothing displays them. `WeekPlan.astro` already renders a week as the chosen meal per slot, with the other options collapsed.

## Desired End State

A "History" link on the dashboard opens `/history`: every week that has ended, newest first, each marked "Saved" or "Not saved". Opening one shows `/history/<id>`, the week rendered like "This week", with an eyebrow "Saved <time>" or "Not saved: MO's recommendation". Anything that isn't the user's own past week answers 404.

## Key Decisions Made

| Decision          | Choice                                                     | Why (1 sentence)                                                                                   |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Which weeks       | Ended weeks only: `week_start ≤ today − 7` (Warsaw)        | Complement of `getCurrentPlan`, so a week is on the dashboard or in history, never both.            |
| Page shape        | List page + one page per week                              | The list loads no option rows, so it stays light as history grows (Workers CPU limit).              |
| Never-saved weeks | Listed, marked "Not saved" / "MO's recommendation"         | Full history per FR-011/012 without passing MO's picks off as the user's meals (S-11's reasoning).  |
| Week view         | Reuse `WeekPlan` unchanged, no recency notes               | It already shows only the chosen meals up front; other options stay collapsed. No new component.    |
| Bad ids           | uuid check (zod), then an owner + past-week query; else 404 | Malformed ids never reach Postgres; foreign, current and upcoming plans look the same as missing ones. |
| Entry point       | "History" link in the dashboard header                     | The only navigation surface the app has; `buttonVariants` on `<a>` per CLAUDE.md.                  |

## Scope

**In scope:**
- `getPastPlans` / `getPastPlan` services, `formatPlanSavedStatus` helper and its unit test
- `/history` and `/history/[id]` pages (empty, error and 404 states), `PROTECTED_ROUTES`, dashboard link
- Smoke steps, README section and walkthrough step

**Out of scope:**
- Filtering, search, pagination
- Recency notes or ratings on history pages (ratings are S-08)
- Listing the in-progress week; hiding never-saved weeks
- Any migration or API route

## Architecture / Approach

Server-rendered Astro pages, as on the dashboard. Both read through the user's cookie-session Supabase client (RLS, plus a `user_id` filter as defence in depth) with the existing PGRST303 retry. The list selects four `weekly_plans` columns; the week page selects one plan with its options and hands it to `WeekPlan`, whose `label` prop carries the saved status.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                       |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. History pages                   | Services, helper + test, two pages, protection, dashboard link | Off-by-one in the Warsaw week boundary vs `getCurrentPlan`      |
| 2. Smoke test, README and roadmap  | CI coverage of protection, empty state, listing, week page and 404s; docs | The past-week delivery must not disturb existing recency smoke steps |

**Prerequisites:** S-02 done (it is); local Supabase for smoke.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes MO never delivers two plans for one week (`ingest_weekly_plan` replaces on re-send), so one row per week in the list.
- The smoke's past-week delivery is never saved, so per S-11 it produces no recency notes; if that rule changes, the existing recency smoke steps need rechecking.

## Success Criteria (Summary)

- From the dashboard, the user reaches a newest-first list of their ended weeks and opens any of them.
- Each past week clearly says whether the user saved it or it is only MO's recommendation.
- Nobody can open a week that isn't their own past week; CI's smoke job proves it.
