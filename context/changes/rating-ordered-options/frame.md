# Frame Brief: Order meal options by the user's ratings (S-13)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

On "Next week", each slot's options are listed by MO's score only (`byScoreThenIndex`,
`src/lib/plans.ts:36`). A meal the user rated 1/5 (🤢 Never again) can be listed first and preselected,
and a meal they rated 5/5 (😋 Chef's kiss) can be listed low.

## Initial Framing (preserved)

- **User's stated cause or approach**: the listing ignores the user's own ratings; order should follow
  them: 5/5 always first, 1/5 always last, whatever MO's score (roadmap S-13 Outcome).
- **User's proposed direction**: sort each slot's options by rating. Open: where 2/5–4/5 go, whether the
  preselected option changes too, and which rating counts when a meal was rated several times.
- **Pre-dispatch narrowing** (2026-10-08): what bothers the user more is **what's preselected**, then
  where meals are listed ("2 more than 1, but 1 is also important"). Scope: **every week view**, not only
  "Next week". Mid ratings: not sure yet.

## Dimension Map

1. **List order**: the sort inside `groupPlanOptions` ignores ratings. ← initial framing
2. **Preselection on a never-saved plan**: `ingest_weekly_plan` stores `is_chosen = is_recommended`
   (`supabase/migrations/20261006120000_week_resubmission_rules.sql`, insert `case … else r.is_recommended`).
   MO doesn't know mo-web's ratings (no mo-web → MO integration, PRD FR-013 note), so it can recommend a
   1/5 meal.
3. **Mid-scale ratings (2–4) vs MO's score and unrated meals**: no rule yet.
4. **Which rating counts**: `get_plan_ratings` uses the latest *earlier* day's rating of the same
   `provider_meal_id` (`supabase/migrations/20261008120000_meal_ratings.sql:95-119`), as "Last rated" shows.
5. **Read-only views** ("This week", `/history/<id>`): `MealSlot.astro` shows the chosen meal, then
   "Other options" in score order; no earlier-ratings lookup is loaded there.

## Hypothesis Investigation

The surface is small (one sort, one RPC, one ingest function), so it was read directly rather than via sub-agents.

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Order ignores ratings | `plans.ts:36-80` sorts by score, then index; ratings reach the editor only as the "Last rated" note (`UpcomingWeekEditor.tsx:83,121`) | STRONG, cheap to address |
| 2. Preselection ignores ratings, and lives in the DB | `is_chosen` set at ingest; `confirm_plan` ("Keep as recommended") saves the current `is_chosen` as-is; `rate_meal` only accepts `is_chosen` rows (migration lines 55-67); history labels an unsaved week "Not saved: MO's recommendation" | STRONG, and the main pain per the user |
| 2a. An ingest-time pick would go stale | Possible: a rating given after delivery (window = meal day to +7) changes `get_plan_ratings`. But per the user, meals don't repeat weekly; a repeated meal was usually eaten 2+ weeks ago and is already rated at delivery | WEAK, corner case needing a rule, not the main flow |
| 3. Mid ratings need a rule | User supplied one (below) | Settled |
| 4. Which rating counts | Existing rule already matches the visible "Last rated" note; user didn't ask to change it | Settled by default |
| 5. Read-only views | User: "first always the selected one; rest, whatever is easier" | Settled (low stakes) |

## Narrowing Signals

- On an unsaved plan, the preselected option should be **mo-web's best guess for the user**, not MO's pick
  as delivered. History then shows mo-web's pick, not "MO's recommendation".
- The user's rule, a **virtual score** per option (MO score 1–10):
  - 5/5 → always top; 1/5 → always bottom
  - 4/5 → score + 2; 2/5 → score − 2
  - 3/5 and unrated → score as is (implied; confirm in plan)
- Worked example: A 9/10 unrated vs B 7/10 rated 4/5 → both 9: **a tie-break is still undefined** (MO
  score, then menu order, is the existing convention).
- Read-only views: chosen meal first (already true), other options' order is free.
- **Regular flow**: a repeated meal was usually eaten 2+ weeks earlier and is already rated when the week
  is delivered. A rating arriving after delivery is a corner case that needs a rule, not the design driver.
- **Star**: goes to the top option of the rating-adjusted order (best virtual score), not to MO's top score
  or MO's pick. Star, order and preselection then agree.

## Cross-System Convention

- Recency notes count only **saved** plans' choices (`20261007120000_recency_saved_plans_only.sql`), so
  changing an unsaved plan's preselection doesn't affect recency.
- The parked "Smarter tie-break between equally scored options" item (roadmap, Parked) is the same lever,
  mo-web deciding the default instead of MO. This slice partly absorbs it.
- A saved plan is never re-picked: re-delivery keeps saved choices (FR-018); the guess applies only while
  `saved_at is null`.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: each slot's order, star and (on a plan the user hasn't saved)
> default choice should come from one rating-adjusted score, with the default stored as the same row that
> "Keep as recommended" saves and that becomes rateable once the week starts.

The initial framing (order by rating) holds for the listing and is the easy half. The weight is in the
preselection: it is stored state (`is_chosen`), not display, and it is read by `confirm_plan`, `rate_meal`
and the history status. A display-only pick would show one meal and save or rate another. In the regular flow
the ratings are already there at delivery; a rating given after delivery is a corner case that needs an
explicit rule. The star moves to the top of the adjusted order, so star, order and preselection agree, which
resolves the readability risk in the roadmap.

## Confidence

**HIGH**: every claim is backed by the files above, and the user settled the design positions directly.

## What Changes for /10x-plan

Plan two things: the virtual-score order and star (shared by the editor and the read-only "Other options"
lists), and storing an unsaved plan's `is_chosen` as the best virtual score. Also settle the tie-break,
the rule for a rating given after delivery (corner case), and the wording that replaces "MO's
recommendation" / "Keep as recommended". The preselection part likely needs a migration. Per `CLAUDE.local.md` the local Supabase
stack is shared with the S-09 worktree, so ask before applying it.

## References

- Source files: `src/lib/plans.ts:36-80`, `src/components/plan/UpcomingWeekEditor.tsx:63-140`,
  `src/components/plan/MealSlot.astro:33-77`, `supabase/migrations/20261008120000_meal_ratings.sql:39-119`,
  `supabase/migrations/20261006120000_week_resubmission_rules.sql:85-125`,
  `supabase/migrations/20261003120000_plan_choices.sql:4-33`
- Roadmap: `context/foundation/roadmap.md` § S-13; issue #93
- Related research: none
