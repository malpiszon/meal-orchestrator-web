# Review fixes

- [x] **F1 (impl-review-phase-1, Fix A)** — Phase 2, `src/pages/api/mo/deliveries.ts`: classify the RPC error with `isAuthRejection({ ...result.error, status: result.status })`, not `result.error` alone. `PostgrestError` has no `status`; a rejected key arrives as HTTP 401 with code `42501` (anon key as service key, observed locally) or, on hosted, probably with no code at all. The `inviteUserByEmail` / `createUser` errors carry `status` and pass as-is.
