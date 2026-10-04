# Review fixes queued for later phases

## From impl-review-phase-1 (F4) — apply in Phase 2

When Phase 2 makes `src/lib/auth-link.ts` per-type, build `authLinkQuerySchema` and `setPasswordLinkSchema` (`src/lib/set-password.ts`) from shared pieces: one `token_hash` rule, and the set-password link-type enum reused in `auth-link.ts`, so adding `"invite"` in S-04 can't leave the two lists out of step.

## From Phase 2 manual testing — note in Phase 3 handoff

Right after a reset, the redirect to `/dashboard` can reach PostgREST within a second of the session being issued. Once (not reproduced in 15 scripted runs) one of the dashboard's two parallel plan queries got 401 `PGRST303 JWT issued at future`, and the page showed "Something went wrong"; a reload fixed it. Pre-existing exposure (F-01's link also redirected straight to `/dashboard`). Candidate follow-up, outside S-05: retry the dashboard plan load once on `PGRST303`.
