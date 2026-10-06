<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Re-sent week replaces the stored recommendation (S-06)

- **Plan**: context/changes/week-resubmission-replace/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria evidence:
- **pgTAP:** 85/85 (`npx supabase test db`).
- **Lint, unit tests and type check:** lint passes; unit tests 120/120; `astro check` 0 errors.
- **Build and smoke:** they ran in Phase 2 on code identical to HEAD (only plan.md and change.md changed since) and passed every step.
- **Manual checks:** 1.3 and 2.6–2.8 were confirmed by the user.

Unplanned changes:
- `prd.md` and `roadmap.md`: FR-018 was folded into S-06. These are benign planning edits.

## Findings

### F1 — A stale page can still "Keep as recommended", saving choices the user never saw

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: README.md:216, src/components/hooks/usePlanChoices.ts:54, supabase/migrations/20261003120000_plan_choices.sql (confirm_plan)
- **Detail**:
  - The README says "A page opened before the re-send can't save anymore (the option ids are new)". The hook's docstring says the same. That holds only for `choose`.
  - A re-send updates the plan row in place, so `planId` stays valid.
  - On a page opened before the re-send, "Keep as recommended" calls `confirm_plan(planId)`, which answers 200 and sets `saved_at`. It saves the new delivery's choices (MO's new recommendation), while the page still shows the old options next to "Saved …". From then on, S-06 keeps those unseen choices on every later re-send.
  - The same thing could happen before S-06, but the new docs say it can't.
- **Fix A ⭐ Recommended**: Correct the README and the docstring (only a swap detects a stale page), and record the stale confirm as a follow-up item.
  - Strength: The docs become accurate now. The window is narrow: a never-saved plan, a page open across a re-delivery, then a tap on "Keep as recommended".
  - Tradeoff: The gap stays until the follow-up is done.
  - Confidence: HIGH — the claim was verified in confirm_plan's body.
  - Blind spot: How often MO re-sends while users have the page open.
- **Fix B**: Make `confirm_plan` take the page's `received_at` (or `mo_run_id`) and raise `not_found` on a mismatch, so the reload message shows.
  - Strength: Closes the gap with the existing 404 → "This plan was updated" path.
  - Tradeoff: A new migration (with a signature change, so the grants change too), plus changes to the route schema, the dashboard props, the hook, pgTAP and smoke. It also needs the production push timing, as for every migration.
  - Confidence: MED — straightforward, but it touches every layer.
  - Blind spot: An old Worker calling the new signature during the deploy window.
- **Decision**: FIXED (Fix A) — README and hook docstring corrected; stale confirm queued in `follow-ups/review-fixes.md`

### F2 — Migration header claims the rest of the body is unchanged

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261006120000_week_resubmission_rules.sql:20-21
- **Detail**: The header says that besides the insert/update split, "the rest of the body is unchanged from 20261003120000_plan_choices.sql". The option insert also changed: `is_chosen` is now set by the carry-over.
- **Fix**: Reword it to "…and the option insert picks `is_chosen` by the carry-over; the rest is unchanged from …".
- **Decision**: FIXED — header comment reworded (comment only)

### F3 — Two doc sentences overstate a case

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md:131, README.md:211
- **Detail**:
  - The contract calls a re-POST of the saved `mo_web_payload.json` "identical". That holds only if it is the latest payload stored for that week. Re-posting an older run's file after a newer run replaced it counts as changed: an upcoming week reverts, and a started week gets 409.
  - The README Re-delivery parent bullet is phrased as "re-sends an upcoming week with changes", but two of its sub-points (identical re-send, started week) are other cases.
- **Fix**: Add "(the latest one sent for that week)" in the contract, and reword the README parent bullet to "When MO re-sends a week:".
- **Decision**: FIXED — contract qualified with "(the latest one sent for that week)"; README parent bullet reworded to "when MO re-sends a week:"

### F4 — The 409 log line can't be traced to a delivery

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:151
- **Detail**: `mo delivery refused: week_started <date>` doesn't identify the user or run. With several refusals, an operator can't match them to MO's ops alerts. The email is excluded on purpose.
- **Fix**: Append `delivery.run_id`, which is not personal data and also appears in MO's logs.
- **Decision**: FIXED — log line now ends with `run <run_id>` (or `-` when absent)
