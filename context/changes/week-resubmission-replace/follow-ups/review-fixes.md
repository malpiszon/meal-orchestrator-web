# Review follow-ups

From `reviews/impl-review-phase-1.md` (2026-10-06), to do in Phase 2:

- [x] **F2** — Ship Phase 2 in the same PR as the Phase 1 migration, so production never runs the migration without the 409 mapping (until then `week_started` answers 500 `storage_failed`, which MO retries 3× and alerts on). The contract's new row must say "409 `week_started`: do not retry".
- [x] **F3** — In the MO contract (Idempotency note and "Manual retry option 2"), define "identical" precisely: the same body content (jsonb equality, so key order and whitespace don't matter), `run_id` included. Only HTTP retries and re-POSTs of the saved payload are no-ops; a new MO run for a started week always gets 409 `week_started`.
