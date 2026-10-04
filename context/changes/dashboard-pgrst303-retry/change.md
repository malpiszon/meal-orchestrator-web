---
change_id: dashboard-pgrst303-retry
title: Retry the dashboard plan load once on PGRST303 (JWT issued at future)
status: impl_reviewed
created: 2026-10-04
updated: 2026-10-04
archived_at: null
---

## Notes

GitHub issue #55 (M-1, not a roadmap item). Right after a session is issued (sign-in, reset), a dashboard plan query can reach PostgREST before the JWT's `iat` by its clock and fail with 401 `PGRST303 JWT issued at future`; `src/pages/dashboard.astro:39` logs it and the page shows "Something went wrong" until a reload. Seen after a reset (S-05 Phase 2 manual test) and after a plain sign-in in the local smoke (WSL + Docker), where it fails "dashboard shows no upcoming plan yet". Suspected cause: clock skew between the app host and the Supabase containers. Candidate fix from the issue: retry the plan load once after ~1 s on `PGRST303`.
