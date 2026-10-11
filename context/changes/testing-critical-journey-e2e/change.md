---
change_id: testing-critical-journey-e2e
title: Critical-journey e2e as a CI gate (S-04)
status: implemented
created: 2026-10-11
updated: 2026-10-11
archived_at: null
---

## Notes

Roadmap S-04 (#122), test-plan Phase 4, risks #4 and #7. Playwright setup already done via /10x-e2e-setup (config, auth.setup.ts, seed, test-stack.md ## E2E); it lands on this branch.

Plan must include a fixture-helper phase: deliver a current upcoming week via /api/mo/deliveries, create the test user and set its password via the admin API (idempotent, also works in CI where no user exists). The manually created e2e-test@example.com week (Mon 2026-10-12) goes stale once it starts, so the seed's radio assertion only holds until then.
