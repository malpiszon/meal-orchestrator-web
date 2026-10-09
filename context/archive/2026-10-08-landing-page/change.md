---
change_id: landing-page
title: Landing page
status: archived
created: 2026-10-08
updated: 2026-10-09
archived_at: 2026-10-09T12:45:10Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-10-08 — Phase 1 deviations (agreed with the user)

- Tab titles read `<page> · Meal Orchestrator` (page first); pages without a title show `Meal Orchestrator`. The plan only changed the default title. The user asked for this during manual verification.
- `public/logo.png` is 256×256 (2× its 128px display size), made from the 1254px source the user supplied, not the 200×200 copy the plan assumed. `apple-touch-icon.png` is made from the same source; `favicon.png` from the original 200px file. The source `mo_logo.png` is not in the repo.
- "No starter leftovers" check: the plan's pattern also matches the product copy "Welcome to Meal Orchestrator…" at `src/pages/auth/set-password.astro:28`, which is expected. The narrower check `grep -rn "Welcome.astro\|<Welcome\|Topbar\|bg-cosmic\|10x Astro Starter\|auth/signup" src/` prints nothing.

### 2026-10-08 — Phase 2 review fixes (agreed with the user)

- A fifth sign-in code, `invalid_link` ("This link is invalid or has expired. Ask for a new one."). `/api/auth/confirm` redirects a malformed link with it and `POST /api/auth/set-password` without Supabase with `not_configured`, so no route puts free text in `/auth/signin?error=` (impl-review-phase-2 F1). Smoke checks the confirm redirect.

### 2026-10-08 — Full-plan review fixes (agreed with the user)

- `POST /api/auth/signin` exports `prerender = false`, parses `{email, password}` with zod and catches a non-form body; invalid input redirects with `invalid_credentials` (impl-review F1).
- `/auth/forgot-password?error=` uses fixed codes too (`src/lib/forgot-password-errors.ts`: `invalid_email`, `not_configured`, `invalid_link`), so no auth page renders text from the URL (impl-review F2). This goes past the plan's "no change to the forgot-password or set-password flows' error handling"; the user asked for it in S-09.
