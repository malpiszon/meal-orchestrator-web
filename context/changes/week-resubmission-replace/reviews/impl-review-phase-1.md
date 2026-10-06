<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Re-sent week replaces the stored recommendation (S-06)

- **Plan**: context/changes/week-resubmission-replace/plan.md
- **Scope**: Phase 1 of 2
- **Reviewed phases**: 1
- **Date**: 2026-10-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria: `npx supabase test db` was re-run during the review (4 files, 85 tests, PASS). `npx supabase db reset` was not re-run, so the plan the MO job had just delivered to local data was kept; it passed at efbd449, and the local DB runs that migration. Manual check 1.3 rests on the MO job run (changed re-send of week 2026-10-05 refused with `week_started`, stored week unchanged) and on a rolled-back SQL reproduction.

## Findings

### F1 — Concurrent first deliveries bypass the re-send rules

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006120000_week_resubmission_rules.sql:52-94
- **Detail**: When no plan exists yet, `select … for update` locks nothing. Two concurrent deliveries for the same (user, week_start) both pass the checks. The second one waits on the unique index, then takes `on conflict do update` on the row the first one committed. That update skips the identical and started checks, sets `saved_at = null` and re-creates the options with `is_chosen = is_recommended`.
  - For a started week, the later payload silently replaces the first instead of being refused with `week_started`.
  - For an upcoming week, a swap committed in between would be lost. That window is microseconds, so it is practically unreachable.
  - Identical concurrent retries (MO retrying a slow first delivery) are harmless.
  - The comment at lines 81-82 ("null for a first delivery") doesn't hold in this race.
- **Fix A ⭐ Recommended**: When the select finds no row, `insert … on conflict (user_id, week_start) do nothing returning id`. If that returns nothing, re-run the locked select and apply the rules (a single retry).
  - Strength: Closes the gap with the same lock-then-decide model; every delivery then goes through the identical and started checks.
  - Tradeoff: About 10 more lines of plpgsql, and the insert is split from the update. pgTAP can't exercise the race (it needs two sessions).
  - Confidence: MED — the standard Postgres upsert-race pattern, but untested here.
  - Blind spot: No concurrent test harness exists in the repo.
- **Fix B**: Accept the gap and document it in the migration header.
  - Strength: No code change. The realistic case (identical concurrent retries) is harmless, and a started week's swaps are already locked.
  - Tradeoff: The rule "a started week can't be re-sent" has a known hole for two different first deliveries at the same moment.
  - Confidence: HIGH — the analysis shows no user choice can be lost in practice.
  - Blind spot: MO sends deliveries sequentially per user; not verified that parallel sends never happen.
- **Decision**: FIXED (Fix A) — a missing week is claimed with `insert … on conflict do nothing`; a lost race re-reads the row under lock and applies the rules. pgTAP 85/85; a two-session race run by hand (2026-09-21, payloads differ) ended with the second session raising `week_started` and the first payload kept.

### F2 — Refused re-send answers 500 until Phase 2 ships

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:147-149
- **Detail**: `week_started` falls through to `500 storage_failed`, which MO retries three times and then alerts on. This was observed locally on 2026-10-06. The plan's Migration Notes already expect it.
- **Fix**: Ship Phase 2 in the same PR, so production never has the migration without the 409 mapping. The Phase 2 contract row must say "409 week_started: do not retry".
- **Decision**: FIXED (queued) — Phase 2 follow-up in `follow-ups/review-fixes.md`

### F3 — Idempotency is byte-content of the body, so a new MO run is never "identical"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261006120000_week_resubmission_rules.sql:60
- **Detail**: The no-op compares only `p_raw` (jsonb equality: key order, whitespace and `1`/`1.0` are ignored). Every MO run carries a new `run_id`, and email casing or unknown nested keys also count, so re-running MO for a started week always gets `week_started`. Only HTTP retries and re-POSTs of the saved payload are no-ops. An identical re-send also never re-applies a later change to `toOptionRows`. All of this is intended by the plan but not yet written down for MO.
- **Fix**: In Phase 2's contract update, state exactly what counts as identical (same body content, including `run_id`) next to the Idempotency note and "Manual retry option 2".
- **Decision**: FIXED (queued) — Phase 2 contract follow-up in `follow-ups/review-fixes.md`

### F4 — Carry-over ignores the provider

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006120000_week_resubmission_rules.sql:131-134
- **Detail**: A kept choice is matched on (meal_date, meal_type, provider_meal_id) only. If a re-send changed `provider`, a choice could carry over to another provider's meal with the same id. Recency, by contrast, keys on provider. It is very unlikely, since a week's provider doesn't change.
- **Fix**: Leave as is. Optionally, leave `v_kept` empty when `p_provider` differs from the stored provider.
- **Decision**: SKIPPED
