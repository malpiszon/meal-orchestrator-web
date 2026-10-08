# Frame Brief: "Next week" shows the nearest upcoming week

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

When MO has delivered more than one future week for a user (for example W+1 and W+2), the dashboard's
"Next week" tab shows the later one (W+2). The nearer week (W+1) appears nowhere: not on the dashboard,
and not in `/history` until a week after its Monday.

## Initial Framing (preserved)

- **User's stated cause or approach**: "Next week" should mean the nearest upcoming week; today it is the
  latest future week (S-01's tie-break, kept by S-02's implementation review, F4).
- **User's proposed direction**: show the nearest upcoming week under "Next week". Open unknown: is a second
  future week hidden until the nearer one starts, or shown too (for example in its own tab)?
- **Pre-dispatch narrowing**:
  - Seen only in testing and the README walkthrough, never from a real MO run.
  - Both concerns weigh the same: the nearer week can't be reached, and the tab label is wrong.
  - The far-ahead week is not a "mistake": MO's rules may change and it may deliver earlier ("because why
    not"). mo-web's rules stay as they are for now, though, and the user doesn't need to see that week early.

## Dimension Map

1. **Selection rule** (`getUpcomingPlan`, `src/lib/services/plans.ts:18-31`): `week_start > today`, ordered
   descending, `limit(1)`. The newest week wins.  ← initial framing
2. **Input: what MO can deliver.** MO sets `week_start` to the nearest upcoming Monday
   (`context/archive/2026-09-30-mo-weekly-delivery/plan.md:16`). mo-web accepts any future Monday
   (`src/lib/mo-delivery.ts:97`), so the case is reachable but not produced by MO today.
3. **Rules after selection** (edit cut-off, recency, ratings): could these assume "the upcoming plan is the
   latest", so that switching the rule breaks them?
4. **Test fixtures that create and rely on the case** (`scripts/smoke.mjs:146`, README walkthrough step 6).

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. The selection rule hides the nearer week | `plans.ts:30` `.order("week_start", { ascending: false })`. S-01 picked "latest wins" as a tie-break with one tab and no stated reason (`archive/2026-09-30-mo-weekly-delivery/plan.md:102`). S-02 kept it as "harmless while MO delivers only the following week" (`archive/2026-10-02-recency-annotated-plan/reviews/impl-review.md:55-75`) | STRONG |
| 2. The input is wrong (MO mis-delivers) | MO only targets the nearest Monday. The user says a faster MO cadence is legitimate, so a far-ahead week is valid input, not an error to reject | NONE (as a cause); this is context for the rule |
| 3. Later rules assume "latest" | The cut-off is `week_start > today` for any week (`supabase/migrations/20261003120000_plan_choices.sql:6`). Recency and ratings take a `planId` and look at earlier dates (`dashboard.astro:44-63`). No migration uses `max(week_start)` or orders by it descending | NONE: they follow whichever plan is shown |
| 4. Fixtures depend on the current rule | The smoke's later-week recency step (`smoke.mjs:298-304`, `:878-884`) and walkthrough step 6 deliver a week after the saved upcoming one and expect "Next week" to switch to it. `upcomingMonday()`'s JSDoc (`smoke.mjs:140-145`) states the dependency | STRONG (cost, not cause) |

## Narrowing Signals

- The case only happens in testing, so the impact today is through fixtures, docs and the risk of a future
  MO cadence change, not reported user harm.
- The user rejected "far-ahead delivery = mistake". mo-web should accept and store it, and decide what to
  show from its own rule, independent of MO's cadence.
- The user rejected showing the far week early. The open unknown is settled: a second future week stays
  hidden until the nearer one starts, then it becomes "Next week" as W+1 moves to "This week".
- The user's harm, made concrete: under the current rule the hidden W+1 is the week with the *earliest*
  deadline. It reaches "This week" never seen and never saved, so it also never feeds recency notes
  (FR-008 counts saved plans only). The label being wrong is the visible part of that.

## Cross-System Convention

Earlier slices already handled this question twice (S-01: tie-break; S-02 F4: kept, because MO delivers one
week). Both decisions rested on MO's cadence. The user's answer removes that premise: mo-web's view shouldn't
depend on how far ahead MO delivers. "Nearest first" also matches the PRD's lifecycle (FR-007/009/010: the
upcoming plan is the one editable until its first day, and the nearest one is the one whose deadline comes first).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: "Next week" must be the nearest future week, so that the week
> with the earliest edit deadline is always the one the user can see, swap and save. Later future weeks are
> stored but not shown until they become the nearest.

The initial framing was correct. The investigation adds two things: the second-week question is answered
(hidden, no extra tab), and the cost is mainly in the smoke and README, which today rely on a later week
replacing the saved upcoming one. Rules after selection (cut-off, recency, ratings) don't depend on the
selection rule.

## Confidence

**HIGH**: direct code evidence for the cause, no hidden dependency in SQL or later rules, and the user's
answers settle the one open design question.

## What Changes for /10x-plan

Plan the selection-rule change for "Next week" (nearest future week, later weeks hidden until they're
nearest) and the rework of the smoke's later-week recency step, `upcomingMonday()`'s JSDoc and README
walkthrough step 6 / "Next week" wording, which describe or rely on "latest future week". Keep the
delivery endpoint accepting far-ahead weeks unchanged.

## References

- Source files: `src/lib/services/plans.ts:12-31`, `src/pages/dashboard.astro:31-63`,
  `src/lib/mo-delivery.ts:97`, `supabase/migrations/20261003120000_plan_choices.sql:6`,
  `scripts/smoke.mjs:140-152`, `:298-304`, `:878-884`
- Prior decisions: `context/archive/2026-09-30-mo-weekly-delivery/plan.md:102`,
  `context/archive/2026-10-02-recency-annotated-plan/plan.md:37`,
  `context/archive/2026-10-02-recency-annotated-plan/reviews/impl-review.md:55-75` (F4)
- Roadmap: `context/foundation/roadmap.md` S-12; issue #84
- Investigation: inline reads, no sub-agents (small surface)
