# Review follow-ups

From `reviews/impl-review-phase-1.md` (2026-10-06), to do in Phase 2:

- [x] **F2** — Ship Phase 2 in the same PR as the Phase 1 migration, so production never runs the migration without the 409 mapping (until then `week_started` answers 500 `storage_failed`, which MO retries 3× and alerts on). The contract's new row must say "409 `week_started`: do not retry".
- [x] **F3** — In the MO contract (Idempotency note and "Manual retry option 2"), define "identical" precisely: the same body content (jsonb equality, so key order and whitespace don't matter), `run_id` included. Only HTTP retries and re-POSTs of the saved payload are no-ops; a new MO run for a started week always gets 409 `week_started`.

From `reviews/impl-review.md` (2026-10-06), full-plan review:

- [ ] **F1 (stale confirm)** — Not in this PR. On a page opened before a re-delivery, "Keep as recommended" still saves (the plan id survives a re-send), so it can save choices the user never saw, which S-06 then keeps on later re-sends. Proposed fix: `confirm_plan` takes the page's `received_at` (or `mo_run_id`) and raises `not_found` on a mismatch, so the page shows the existing "This plan was updated" message. Needs a migration (signature change and grants), plus changes to the route, dashboard props, hook, pgTAP and smoke.
