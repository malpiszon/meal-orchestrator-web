<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan history list

- **Plan**: context/changes/plan-history-list/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Scope note: the out-of-plan additions (S-12 in the roadmap, the "Back to your meals" button on the week page) were requested by the user during implementation; the eslint allowlist was accepted in the phase 1 review (F2).

## Findings

### F1 — Current-week edge of /history/<id> is not smoke-tested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:552-562
- **Detail**: `getCurrentPlan` uses `week_start > today − 7` and the history services `<= today − 7`, so an off-by-one would show on the current week. The smoke only checks the upcoming week (far from the boundary) and a malformed id. The current week's `plan_id` comes back from an existing delivery step but isn't kept.
- **Fix**: Keep the current-week delivery's `plan_id`; add "history hides the current week" (404 "Plan not found", and no `/history` list item for it). Optionally add an anonymous redirect check for `/history/not-a-uuid`.
- **Decision**: FIXED — current-week plan_id kept; "history hides the current week" (404) added and the list step checks it isn't listed; anonymous redirect checked for `/history/not-a-uuid` too. Break-check: with the bound at `<= today` the new step went red

### F2 — Another user's past plan is not smoke-tested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs (history block)
- **Detail**: The README promises 404 for someone else's plan, and RLS + the `user_id` filter enforce it, but no runtime check guards it against regression.
- **Fix**: Deliver the past week to the `newUserDelivery` account too, keep its `plan_id`, and expect 404 "Plan not found" for it while signed in as the smoke user.
- **Decision**: FIXED — the past week is also delivered to the account a delivery creates; "history hides another user's past week" (404) added and the list step checks it isn't listed

### F3 — Smoke history helpers and data can be tightened

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs:243-245, 254, 363-368, 521-529
- **Detail**: (a) The past week reuses the unrenamed sample, so `oldName` now also occurs in it, and the comment saying it "still occurs only in the upcoming week" is stale; the week-page step can't tell whose data it rendered. (b) `historyItemFor` splits on `"<li"`, which also splits `<link` tags. (c) The past-delivery step doesn't assert `account_created: false` like its neighbour.
- **Fix**: Give the past week its own meal name (`pastName`) and check it on the week page, fix the comment, split on `/<li\b/`, and assert `account_created === false`.
- **Decision**: FIXED — past week has its own meal name (`pastName`) checked on its page, so the `oldName` invariant holds again; `historyItemFor` splits on `/<li\b/`; past deliveries assert `account_created: false`

### F4 — Week page header differs from the other two headers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/history/[id].astro:37-46
- **Detail**: Dashboard uses a `shrink-0` button group without wrapping; `/history` a plain `justify-between`; the week page wraps both header and group. At 320px the second button drops to a third line. The "Back to your meals" label was chosen by the user to match `/history`.
- **Fix**: Keep as is (it doesn't overflow, and the labels are the user's choice).
- **Decision**: FIXED — accepted as is (no overflow; labels chosen by the user)

### F5 — README doesn't say a load error answers 200

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: README.md (Plan history)
- **Detail**: On a database error both history pages show "Couldn't load your history" with status 200 (as the dashboard does); the README's 404 list could suggest otherwise.
- **Fix**: Add one clause to the Plan history subsection.
- **Decision**: FIXED — Plan history subsection says a load error answers 200 with "Couldn't load your history"; smoke paragraph lists the new checks
