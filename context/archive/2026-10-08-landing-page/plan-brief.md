# Landing Page (S-09) — Plan Brief

> Full plan: `context/changes/landing-page/plan.md`
> Research: `context/changes/landing-page/research.md`

## What & Why

A user opening `/` should land on a sign-in page that looks finished and matches the app, then log in or follow "forgot password" into the reset flow. Today `/` is the starter's "10x Astro Starter" page with hard-coded cosmic styling. Roadmap S-09 / issue #18 also requires an automated test of both paths from `/`.

## Starting Point

The styled sign-in card already exists at `/auth/signin` and links to "Forgot or never set a password?". Sign-in currently redirects to `/` on success, raw Supabase error text travels in `?error=` (F9), and the tab shows the starter's title and favicon. Only `scripts/smoke.mjs` tests over HTTP, and it checks `/` for 200 only.

## Desired End State

`/` redirects: signed out to `/auth/signin`, signed in to `/dashboard`. The sign-in page shows the Meal Orchestrator logo above the card, signing in lands on the dashboard, and errors show fixed messages chosen by a code. The favicon and default title are the product's, the starter components are deleted, and smoke walks both DoD paths in CI.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `/` vs `/auth/signin` | `/` redirects to `/auth/signin` | Smallest change; every existing `/auth/signin` reference, the middleware and CI keep working. | Plan |
| Signed-in visitor / sign-in target | `/`, `/auth/signin` and successful sign-in all go to `/dashboard` | US-03 "they reach their dashboard"; matches set-password; avoids landing on a form after login. | Plan |
| Logo placement | Sign-in card + favicon (robot-head crop) + apple-touch icon | Brands the entry point; other pages stay for the parked app-wide UI pass. | Plan |
| Logo delivery | Static `public/logo.png` via `<img>` with explicit size, no upscaling | Astro's image service needs sharp at runtime, unavailable on Workers; source is 200px. | Plan |
| Deferred items | F9 error codes + default title in; `--info` token and F7 tint out | Both in-scope items live on this page; the others are dashboard/banner styling for `/10x-ui`. | Research → Plan |
| Error codes | `invalid_credentials`, `rate_limited`, `not_configured`, `sign_in_failed`; unknown URL code shows nothing | Fixed text removes content spoofing; raw message goes to Worker logs. | Plan |
| Test form | Extend `scripts/smoke.mjs`, no Playwright | Already runs in CI; meets the "automated test" DoD without new tooling. | Research → Plan |
| Reset step in smoke | Unknown email → `?sent=1` | Same response as a real account, sends no email, so the Mailpit step's 2/hour budget is kept. | Plan |

## Scope

**In scope:**
- `/` redirect; signed-in redirect on `/auth/signin`; sign-in success → `/dashboard`
- Logo on the sign-in page; favicon and apple-touch icon from the logo; default title "Meal Orchestrator"
- Delete `Welcome.astro`, `Topbar.astro`, `bg-cosmic`; drop the legacy-exception sentence in CLAUDE.md/AGENTS.md
- F9: error codes with fixed messages (lib helper + vitest), API, page, smoke and CI post-deploy grep
- Smoke steps for both DoD paths; README auth-routes and smoke sections

**Out of scope:**
- Logo on other pages; `--info` token for `RecencyNote`; F7 banner tint
- Playwright/browser tests; any migration; marketing copy; sign-out target change

## Architecture / Approach

`index.astro` is frontmatter-only and branches on `Astro.locals.user`, which middleware already resolves. `signin.astro` gains the same signed-in redirect and an `<img>` above the existing card. A pure `src/lib/signin-errors.ts` maps Supabase `error.code` to an app code (API side) and app code to message (page side). Each phase updates the smoke expectations its behaviour changes, so CI stays green throughout.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Entry point and branding | `/` redirects, logo + favicon, sign-in → dashboard, starter removed | Logo or favicon crop looking off in dark mode or at phone width (manual check) |
| 2. Fixed sign-in errors (F9) | Code-based errors with fixed messages, CI grep updated | Post-deploy grep must change in the same PR as the API |
| 3. DoD smoke coverage and docs | Smoke walks `/` → sign in → dashboard and `/` → forgot → reset request; README | Shared smoke data with the S-12 worktree; re-run a failing step alone first |

**Prerequisites:** S-05 done (it is). The local Supabase stack is running and shared, so don't restart it. Preview and smoke run on :4322.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- The robot-head favicon crop is a judgement call; if it reads poorly at 32px, fall back to a simplified crop (head only, no hat) during Phase 1 manual check.
- Supabase may return error codes other than the two mapped ones (e.g. `email_not_confirmed`); they fall to the generic `sign_in_failed` message by design.
- Visual polish beyond "finished and matching" is left to the later `/10x-ui` pass the roadmap names.

## Success Criteria (Summary)

- Opening `/` signed out shows the branded sign-in page; signed in, it opens the dashboard.
- Signing in lands on the dashboard; "Forgot or never set a password?" reaches the reset request.
- CI's smoke proves both paths, and no starter content or `/auth/signup` link remains.
