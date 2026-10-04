# Review fixes queued for later phases

## From impl-review-phase-1 (F4) — apply in Phase 2

When Phase 2 makes `src/lib/auth-link.ts` per-type, build `authLinkQuerySchema` and `setPasswordLinkSchema` (`src/lib/set-password.ts`) from shared pieces: one `token_hash` rule, and the set-password link-type enum reused in `auth-link.ts`, so adding `"invite"` in S-04 can't leave the two lists out of step.
