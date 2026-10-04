# Review fixes queued for later phases

## From impl-review-phase-1 (F4) — apply in Phase 2

When Phase 2 makes `src/lib/auth-link.ts` per-type, build `authLinkQuerySchema` and `setPasswordLinkSchema` (`src/lib/set-password.ts`) from shared pieces: one `token_hash` rule, and the set-password link-type enum reused in `auth-link.ts`, so adding `"invite"` in S-04 can't leave the two lists out of step.

## From Phase 2 manual testing — note in Phase 3 handoff

Right after a reset, the redirect to `/dashboard` can reach PostgREST within a second of the session being issued. Once (not reproduced in 15 scripted runs) one of the dashboard's two parallel plan queries got 401 `PGRST303 JWT issued at future`, and the page showed "Something went wrong"; a reload fixed it. Pre-existing exposure (F-01's link also redirected straight to `/dashboard`). Candidate follow-up, outside S-05: retry the dashboard plan load once on `PGRST303`.

## From impl-review-phase-2 — apply in Phase 3

- **F1 (fixed in code):** add a smoke step proving that a signed-in session without the `mo-password-retry` cookie gets the invalid-link page and that a token-less POST is redirected to `/auth/forgot-password`, and that a rejected save after `verifyOtp` (same password → `same_password`) allows a token-less retry. Mention the retry gate in the S-04 handoff: the invite retry uses the same cookie.
- **F2:** don't push the branch or open the PR before Phase 3 rewrites the smoke steps at `scripts/smoke.mjs:447-471`.
- **F3:** note as a known risk (plan risks / README): Workers request logs record `/auth/set-password` and `/api/auth/confirm` URLs, so an unused reset token valid for up to 1 h sits in logs readable by account admins.
- **F5:** in the README pass, replace the old reset-link descriptions (`README.md` "Auth routes", email-link production setup, smoke section) and give the subject as "Set a new Meal Orchestrator password"; update `context/foundation/infrastructure.md:117`, which names the removed `AUTH_LINK_DESTINATION`. The F-01 handoff note in `roadmap.md:93` is history; leave it alone.
