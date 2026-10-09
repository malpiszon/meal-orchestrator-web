# Rating-ordered options (S-13) — Plan Brief

> Full plan: `context/changes/rating-ordered-options/plan.md`
> Frame brief: `context/changes/rating-ordered-options/frame.md`

## What & Why

The actual problem: each slot's order, star and (on a plan the user hasn't saved) default choice should
come from one rating-adjusted score, with the default stored as the same row that "Keep these picks"
saves and that becomes rateable once the week starts. Today a meal rated 🤢 Never again can be listed
first and preselected because MO doesn't know mo-web's ratings.

## Starting Point

"Next week" sorts by MO's score (`groupPlanOptions`, `src/lib/plans.ts`) and stars every top-score
option. The default choice is stored at delivery as MO's pick (`is_chosen = is_recommended` in
`ingest_weekly_plan`); ratings appear only as the "Last rated" note (`get_plan_ratings`).

## Desired End State

On "Next week", 5/5 meals come first and 1/5 meals last; the first option is starred and, on an unsaved
plan, selected. That selection is what's stored, so "Keep these picks" saves it, it's the meal you rate
once the week starts, and history calls it "Not saved: suggested picks". A rating given after a week was
delivered re-picks that week while it is unsaved and hasn't started.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Score rule | 5/5 always top, 1/5 always bottom (MO score orders within), 4/5 +2, 2/5 −2 | User's rule | Frame |
| 3/5 and unrated | MO score as is | "Fine" is neutral; unrated meals aren't penalised | Plan |
| Tie-break | Adjusted score → MO score → menu order (A 9/10 unrated beats B 7/10 rated 4/5) | Keeps the existing convention; one option starred | Plan |
| Star | First option plus any tied on adjusted and MO score | Star, order and selection agree | Frame / Plan |
| Default choice | Stored `is_chosen` = adjusted pick for never-saved plans | A display-only pick would save/rate a different meal | Frame |
| Rating after delivery | `rate_meal` re-picks the caller's unsaved, not-started plans offering the meal, under plan locks | Keeps star, order and selection in agreement | Plan |
| Saved-plan re-delivery fallback | Adjusted pick where the kept dish is gone | One rule for every default mo-web makes | Plan |
| Which rating counts | Latest earlier rated day (as "Last rated") | Already visible; user didn't ask to change it | Frame |
| Read-only views | Chosen first; "Other options" keep MO order | User: "whatever is easier" | Frame |
| Wording | "Keep these picks"; "Not saved: suggested picks" | The pick is no longer MO's | Plan |

## Scope

**In scope:** SQL `adjusted_score` + `pick_default_choices`; `ingest_weekly_plan` and `rate_meal`
changes; pgTAP; `adjustedScore` and rating-aware `groupPlanOptions` with `starredIds`; dashboard and
editor wiring; wording; Vitest; smoke steps for 5/5 first and 1/5 last; README.

**Out of scope:** rating order on read-only views; changing which rating counts; re-picking saved or
started plans; re-pick on page load or live tab updates; removing `is_recommended`; re-picking plans
stored before the migration; mo-web → MO feedback.

## Architecture / Approach

The rule exists twice on purpose: SQL decides the stored default (at ingest, and in `rate_meal` for late
ratings) using a non-RLS copy of `get_plan_ratings`' lookup; TypeScript orders and stars "Next week"
from the ratings the dashboard already loads. Both share the same formula, tie-break and worked test
cases.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database — rating-adjusted defaults | Migration, ingest + `rate_meal` re-pick, pgTAP | Locking/concurrency in `rate_meal`; shared local Supabase |
| 2. App — order, star and wording | Rating-aware grouping, star, wording, Vitest | TS and SQL rules drifting apart |
| 3. Smoke and README | 5/5-first and 1/5-last smoke steps, wording updates, docs | Planted fixture colliding with existing smoke slots |

**Prerequisites:** S-03 and S-08 done (they are). Ask the user before applying the migration to the
local Supabase shared with the S-09 worktree. Push the migration to production before merging.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- An open "Next week" tab doesn't see a re-pick caused by a rating elsewhere; "Keep these picks" there
  saves the database's current picks (same known gap as re-delivery).
- A bug in the re-pick fails the rating too (one transaction); pgTAP guards it.
- Plans stored before the migration keep MO's pick until re-sent or a matching rating arrives.
- If the ratings fail to load on the dashboard, order falls back to MO's score while the stored pick
  may sit lower in the list.

## Success Criteria (Summary)

- A meal rated 1/5 is never preselected and is listed last; a 5/5 meal is first, starred and preselected.
- What "Next week" shows as selected is what "Keep these picks" saves and what becomes rateable.
- Saved plans keep the user's choices; pgTAP, Vitest and the smoke pass.
