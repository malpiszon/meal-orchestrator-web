<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recency-annotated plan

- **Plan**: context/changes/recency-annotated-plan/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks run for this review: `npm test` (45/45), `npm run lint`, `npx astro check` (0 errors), `npm run build`, `npx supabase test db` (5/5). `supabase db reset` was not re-run, to keep the local walkthrough data; PR #37's CI applied all migrations to a fresh stack and passed `ci` + `smoke`, and the production deploy and post-deploy smoke passed (run 37061899877). Every manual Progress row (1.4, 1.5, 2.3–2.5, 3.3, 3.4) was confirmed by the user in-session.

## Findings

### F1 — S-03 handoff for the "planned" predicate not recorded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: N/A (context/foundation/roadmap.md § S-03; issue #7)
- **Detail**: The plan's "What We're NOT Doing" says S-03 must switch `get_plan_recency`'s "planned" predicate from `is_recommended` to the user's saved choice ("record this in S-03's plan"). There is no S-03 plan yet, and neither the roadmap's S-03 entry nor issue #7 mentions it. The rule exists only in the SQL header and the pgTAP comment, where whoever plans S-03 will likely miss it. The same note should carry the performance lever from F5.
- **Fix**: Comment on #7 and add a line to the roadmap's S-03 entry: S-03 must change `get_plan_recency`'s "planned" predicate (and its pgTAP test) to the saved choice, and consider a partial index or `LATERAL … limit 1` at that point.
- **Decision**: FIXED — roadmap § S-03 "Handoff from S-02" bullet; comment on #7 (issuecomment-5969665883)

### F2 — Smoke recency check isn't scoped to the "Next week" panel

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs ("dashboard shows recency notes on the upcoming week" step)
- **Detail**: The step checks that the note text appears anywhere in the dashboard HTML. A regression that also rendered notes in the "This week" panel (excluded by the plan) would still pass. Separately, if Warsaw midnight Sunday→Monday falls between `currentMonday()` and the "This week" request, that step fails; the window is seconds wide.
- **Fix**: Also assert the current-week meal's slot carries no note, e.g. that the HTML between the current-week meal name and the next panel contains no "In your plan".
- **Decision**: FIXED — the recency step splits the dashboard on `data-slot="tabs-content"` and requires the note in "Next week" and none in "This week"; went red when the current week was given notes, restored. Smoke green twice on a fresh :4322 preview (one earlier cold-start run failed the pre-delivery step once, not reproduced).

### F3 — Two README lines are slightly stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md:119, README.md:217
- **Detail**: Line 119 lists what `npx supabase start` applies (keepalive, weekly-plan tables + `ingest_weekly_plan`) without `get_plan_recency`. Walkthrough step 3 says a user without an upcoming week sees "No upcoming plan yet"; with only a current week, "This week" opens and that card sits in the "Next week" tab.
- **Fix**: Add `get_plan_recency` to line 119, and reword step 3 to "…sees 'No upcoming plan yet' (in the 'Next week' tab once a current week exists)".
- **Decision**: FIXED — README.md:119 lists `get_plan_recency`; walkthrough step 3 notes the "Next week" tab

### F4 — "Next week" can hold a plan two weeks out

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/plans.ts:25 (`getUpcomingPlan`), scripts/smoke.mjs (`upcomingMonday`)
- **Detail**: The tab label changed from "Upcoming week" to "Next week", but `getUpcomingPlan` still returns the latest plan with `week_start > today` (the S-01 choice, kept by this plan's "Not doing" list). The smoke delivers the first Monday ≥ 7 days ahead, which is two Mondays out on 6 days of 7, so CI usually exercises "Next week" holding a week two weeks away (N = 14). Harmless while MO delivers only the following week.
- **Fix A ⭐ Recommended**: Accept, and say so in `upcomingMonday`'s JSDoc ("may be two weeks out; 'Next week' shows the latest future plan, as in S-01").
  - Strength: Matches the plan's explicit decision; no behaviour change in production.
  - Tradeoff: The label stays loosely literal in the two-future-weeks edge case.
  - Confidence: HIGH — the plan's "Not doing" list chose this.
  - Blind spot: How often MO will deliver more than one week ahead.
- **Fix B**: Switch `getUpcomingPlan` to the nearest future week (`ascending: true`).
  - Strength: "Next week" becomes literal.
  - Tradeoff: Changes S-01 behaviour and the plan's decision; would need the smoke and README updated too.
  - Confidence: MEDIUM — untested against MO's real delivery cadence.
  - Blind spot: Whether users want the nearest or the newest delivered week.
- **Decision**: FIXED via Fix A — behaviour kept; `upcomingMonday`'s JSDoc in scripts/smoke.mjs explains the two-weeks-out case and the 14-day gap

### F5 — `get_plan_recency` reads offered-only history rows

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261002190000_plan_recency.sql:24-32
- **Detail**: The `(user_id, provider_meal_id, meal_date)` index serves the join, but `is_recommended` isn't in it, so each option reads every earlier row of that meal (offered-only included) plus a `weekly_plans` PK lookup. Cost grows linearly with history. Fine for the MVP, and it runs in Postgres, not against the Worker's 10 ms CPU.
- **Fix**: No change now; record the lever (partial index or `LATERAL … order by meal_date desc limit 1`) in the S-03 handoff from F1.
- **Decision**: FIXED via F1 — index lever recorded in roadmap § S-03 and on #7

### F6 — pgTAP "own history only" case proves less than its name

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/get_plan_recency.test.sql:25-26,50
- **Detail**: User B's matching row is excluded by the join's `h.user_id = o.user_id`, not by RLS, so this case doesn't show RLS limiting history rows. The isolation still holds (the join and RLS both filter by user, and line 66 shows RLS limiting the plan itself).
- **Fix**: Reword the comment/description to "join keeps history to the plan's owner".
- **Decision**: FIXED — line 49 comment says the join excludes user B; line 55 description now "history of the plan owner only"; `supabase test db` 5/5
