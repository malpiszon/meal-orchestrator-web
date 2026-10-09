<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rating-ordered options (S-13)

- **Plan**: context/changes/rating-ordered-options/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: both migrations applied locally; `npx supabase test db` PASS (6 files, 151 tests, full log kept); `npm test` PASS (144); `npm run lint` PASS; `npx astro check` PASS (0 errors); `npm run build` PASS; smoke PASS on :4323 (93 steps, including the 5/5 and 1/5 steps, Mailpit step included). Manual 1.4, 2.5, 2.6 and 3.3 were confirmed by the user during implementation.

## Findings

### F1 — Swapping on a stale "Next week" tab after a rating saves picks the user never saw

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008180000_rating_ordered_defaults.sql:308-344, README.md:218
- **Detail**: The rating faces and the "Next week" editor are on the same dashboard page. A rating re-picks the unsaved upcoming plan, but the rendered tab keeps the old selection. A re-pick keeps option ids, so a swap afterwards succeeds without "This plan was updated" and saves the plan with the other slots holding re-picked choices that the page doesn't show. The README mentions only "Keep these picks" doing this. The plan accepts "no live update" (plan.md "What We're NOT Doing"), but this saves unseen choices rather than just showing stale ones.
- **Fix A ⭐ Recommended**: Extend the README "Late ratings" bullet to say a swap on such a tab also saves the re-picked choices of the other slots.
  - Strength: Matches the plan's accepted scope; one sentence; the corner case (rate, then swap without reload) is rare.
  - Tradeoff: The behaviour stays; only documented.
  - Confidence: HIGH — the plan already chose no live update.
  - Blind spot: How often users rate and then swap in the same page view.
- **Fix B**: Have `rate_meal` return whether it re-picked any plan, and have the page reload the "Next week" island or show "This plan was updated. Reload to see the latest version."
  - Strength: Removes the unseen-save case.
  - Tradeoff: New migration, API response field and client handling; scope beyond S-13's plan.
  - Confidence: MED — needs a design for the cross-island signal.
  - Blind spot: Not checked how the rating island and the editor island could talk.
- **Decision**: FIXED via Fix A (README Late ratings bullet now covers a swap on a stale tab)

### F2 — Narrow race between a rating and a concurrent delivery

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008180000_rating_ordered_defaults.sql:309-326
- **Detail**: If a delivery commits while `rate_meal` waits on the plan lock (or inserts a new plan), the locking select uses its original snapshot, and ingest's `pick_default_choices` ran without the uncommitted rating. The plan can keep a pick based on the old rating while the dashboard orders by the new one. Only the stored default is off; the window is milliseconds against a weekly delivery.
- **Fix**: Accept it and record it as a known limitation in the plan's Addendum (no SQL change).
- **Decision**: FIXED (accepted as known limitation, recorded in plan.md Addendum)

### F3 — README "Late ratings" omits the same-provider condition

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md:218
- **Detail**: The bullet says the re-pick touches every unsaved upcoming week offering the meal; `rate_meal` also requires the same provider (line 315). Harmless with one provider.
- **Fix**: Say "offers that meal (same provider and meal id)" or similar.
- **Decision**: FIXED (README: "offers that meal (same provider and meal id)")

### F4 — Walkthrough step 8 (unplanned edit) claims "listed first, with the star" for any face

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: README.md:286
- **Detail**: Step 8 was edited beyond the plan's list (steps 5 and 7). It says "for example 😋" and then that the option is listed first with the star, which is true only for 5/5.
- **Fix**: Word it as "with 😋 (5/5) it is also listed first in its slot, with the star".
- **Decision**: FIXED (README step 8: "as 😋 is 5/5, is listed first…")

### F5 — `pick_default_choices` stays executable by service_role

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008180000_rating_ordered_defaults.sql:97
- **Detail**: Revoked from public, anon and authenticated; service_role keeps EXECUTE through default privileges. The function has no cut-off or ownership check, but it only fills slots with no chosen row, which never exist outside its callers, so impact is nil.
- **Fix**: Optionally also revoke from service_role (edit the not-yet-pushed migration and re-apply locally, or a follow-up migration).
- **Decision**: SKIPPED

### F6 — Re-pick boundary `week_start = today` not tested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rating_ordered_defaults.test.sql:311-335
- **Detail**: The "started week untouched" case uses `week_start = d(-1)`; an unsaved plan starting today (the exact cut-off) isn't covered.
- **Fix**: Add an unsaved plan with `week_start = d(0)` offering the meal to the late-rating snapshot assertions.
- **Decision**: FIXED (pgTAP: unsaved week starting today keeps LATE; plan(31); test db PASS, 152 tests)

### F7 — `array_agg` without `order by` in the one-time re-pick

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261009090000_repick_unsaved_upcoming_plans.sql:15
- **Detail**: `rate_meal` uses `array_agg(... order by week_start, id)`; the DO block doesn't. Locks are still taken in order by the subquery, so it is cosmetic.
- **Fix**: Add `order by l.week_start, l.id` for consistency.
- **Decision**: SKIPPED
