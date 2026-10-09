---
date: 2026-10-08T19:37:29+02:00
researcher: Claude (Opus 5.5)
git_commit: 50861a6
branch: landing-page
repository: malpiszon/meal-orchestrator-web
topic: "S-09 landing page: what replacing the starter page at `/` with a sign-in entry point touches"
tags: [research, codebase, landing-page, auth, signin, smoke, ui]
status: complete
last_updated: 2026-10-08
last_updated_by: Claude (Opus 5.5)
---

# Research: S-09 landing page

**Date**: 2026-10-08T19:37:29+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 50861a6
**Branch**: landing-page
**Repository**: malpiszon/meal-orchestrator-web

## Research Question

Roadmap S-09 (issue #18): a user opening `/` lands on a sign-in page that looks finished and matches the rest of the app. From there they can log in or follow "forgot password" into the reset flow. The starter's "10x Astro Starter" page is gone. It is not a marketing page and must not link to `/auth/signup`. The login and reset paths from `/` need an automated test (`context/foundation/roadmap.md:231-242`).

Questions:

1. What renders at `/` today, and what depends on it?
2. Which pages and components already make up the "rest of the app" look that the new page must match?
3. How does the login redirect chain interact with `/`?
4. What test infrastructure exists for "`/` → sign in → dashboard" and "`/` → forgot password → reset request"?
5. Which earlier changes deferred work to S-09?

## Summary

- **What `/` is today.** `src/pages/index.astro:1-8` renders `Welcome.astro`. That page uses the old cosmic look with hard-coded palette colours, plus `Topbar.astro` and a "Sign In" link to `/auth/signin` (`src/components/Welcome.astro:5-36`). Nothing else imports `Welcome` or `Topbar`; the only importers are `index.astro:2` and `Welcome.astro:2`. The `bg-cosmic` utility (`src/styles/global.css:113-115`) is used only by `Welcome.astro:5`.
- **The look to match.** It already exists: a centred shadcn `Card` on `bg-background` with `SignInForm` inside (`src/pages/auth/signin.astro:9-22`). `forgot-password.astro` and `set-password.astro` use the same pattern. `SignInForm` already links to `/auth/forgot-password` with the text "Forgot or never set a password?" (`src/components/auth/SignInForm.tsx:88-92`).
- **Redirect chain problem.** A successful `POST /api/auth/signin` redirects to `/` (`src/pages/api/auth/signin.ts:19`), and sign-out does too (`src/pages/api/auth/signout.ts:9`). Today `/` shows signed-in users a Dashboard link through `Topbar`. Once `/` becomes a sign-in page, a successful login would land back on a sign-in form unless the plan changes the redirect target or redirects signed-in visitors at `/`. US-03 requires "they reach their dashboard" (`context/foundation/prd.md:73-82`).
- **Testing.** There are no page-rendering or browser tests. vitest covers pure `src/lib/**/*.test.ts` only (9 files), and Playwright is absent. The only HTTP-level harness is `scripts/smoke.mjs`, which CI runs against the production preview. Its existing "home renders" step checks `/` for status 200 only (`scripts/smoke.mjs:473`). The issue's Definition of done asks for an automated test of "`/` → sign in → dashboard" and "`/` → 'forgot password' → reset request". An earlier plan said "S-09 introduces browser tests" (`context/archive/2026-09-29-initial-ui-setup/plan.md:42`), but nothing has been set up for that.
- **Work deferred to S-09.** Three items:
  - F9: the `?error=` text reflected on the sign-in page.
  - removing `bg-cosmic` and the `Welcome`/`Topbar` legacy exception.
  - a follow-up for the `/10x-ui` pass: a neutral `--info` token for the recency note.

  Also still open: the default `<title>` "10x Astro Starter" in `Layout.astro:10`, and the CLAUDE.md hard rule that still names the deleted `signup.astro`.

## Detailed Findings

### 1. What `/` is today

- `src/pages/index.astro:1-8` wraps `<Welcome />` in `Layout`.
- `src/components/Welcome.astro`:
  - background, orbs and star field: `bg-cosmic` plus `purple-500/20`, `blue-500/15` and inline `rgba` (lines 5-15);
  - `<Topbar />` (line 18);
  - hero "10x Astro Starter" with a gradient title and pitch copy (lines 21-27);
  - a "Sign In" button-styled `<a href="/auth/signin">` in `bg-purple-600` (lines 29-34);
  - three starter feature cards (lines 39-106).
- `src/components/Topbar.astro:1-30`. A signed-in user (`Astro.locals.user`) gets email, a Dashboard link and a sign-out form. Anyone else gets "Not signed in" and a Sign in link. Hard-coded `white/*` and `purple-*` throughout.
- The CLAUDE.md hard rule lists `Welcome.astro`, `Topbar.astro` and `signup.astro` as legacy exceptions to the token rule "until S-09/S-04". `signup.astro` no longer exists: `src/pages/auth/` contains only `signin`, `forgot-password` and `set-password`.
- `src/layouts/Layout.astro:10` sets the default page title to `"10x Astro Starter"`. `index.astro` passes no `title`, so `/` shows that title. Every other inspected page passes its own title, for example `signin.astro:9` and `dashboard.astro:96`.
- `/` is not in `PROTECTED_ROUTES` (`src/middleware.ts:4`, `["/dashboard", "/history"]`). The middleware resolves `locals.user` on every non-machine request (`src/middleware.ts:15-24`), so a page at `/` can read `Astro.locals.user`.
- `public/` contains `favicon.png` and `template.png`. `template.png` is the README screenshot (`README.md:3`). This research did not check which image `favicon.png` shows.

### 2. The existing auth look the page should match

- `src/pages/auth/signin.astro:9-22`: `<Layout title="Sign in">`, then `div.flex.min-h-screen.items-center.justify-center.bg-background.p-4`, then `Card className="w-full max-w-sm"`, then `CardHeader` / `CardTitle` holding `<h1>Sign in</h1>`, then `CardContent` with `<SignInForm serverError={error} client:load />`.
- `src/pages/auth/forgot-password.astro:11-34` has the same shell plus a `CardDescription`. Its "Back to sign in" link is a plain `<a>` styled with `buttonVariants({ variant: "link" })` (line 27). That is the safe pattern under the "no `asChild` from `.astro`" rule.
- `src/components/auth/SignInForm.tsx`:
  - posts a native form to `/api/auth/signin` (line 45);
  - validates on the client, then lets the browser submit (lines 20-42);
  - shows `ServerError` for `serverError` (line 82);
  - links to `FORGOT_PASSWORD_PATH` with "Forgot or never set a password?" (lines 88-92). The constant is `src/lib/password-rules.ts:15`.
- The signed-in pages use a different shell: `main.min-h-screen.bg-background` with a `max-w-2xl` column and a header that has the `h1`, History or Dashboard outline buttons, and a Sign out button (`src/pages/dashboard.astro:97-115`, `src/pages/history/index.astro:31-35`). No inspected page shows a product name or brand mark. The only product-name mentions are in body copy (`set-password.astro:24,28`; `NoUpcomingPlan.astro:11`). A logo and app-wide visual identity are explicitly parked outside S-09 (`context/foundation/roadmap.md:344`).

### 3. The login redirect chain and `/`

- `POST /api/auth/signin` redirects as follows (`src/pages/api/auth/signin.ts:9-19`):
  - Supabase not configured: `/auth/signin?error=Supabase is not configured`.
  - Wrong credentials: `/auth/signin?error=<Supabase error.message>`.
  - Success: `/`.
- `POST /api/auth/signout` redirects to `/` in every case (`src/pages/api/auth/signout.ts:5-9`).
- The middleware sends anonymous visitors to `/dashboard` or `/history*` on to `/auth/signin` (`src/middleware.ts:26-30`).
- A successful set-password redirects to `/dashboard` (`src/pages/api/auth/set-password.ts:97`). The S-05 brief chose "Stay signed in, redirect to `/dashboard`" (`context/archive/2026-10-04-password-reset/plan-brief.md:23`).
- Implication (inference): as long as `signin.ts:19` keeps redirecting to `/` and `/` shows a sign-in form to every visitor, a successful login lands on a sign-in form. The fix could be one or both of: point `signin.ts` at `/dashboard`, or redirect signed-in visitors from `/` to `/dashboard`. No recorded decision covers what `/` does for a signed-in user. Searched: the archive and foundation docs (sub-agent sweep) and the issue #18 body and comments.
- The literal `/auth/signin` appears in 22 places across 10 files:
  - `src/middleware.ts`, `src/components/Topbar.astro`, `src/components/Welcome.astro`;
  - `src/components/auth/SignInForm.tsx`, `src/pages/auth/forgot-password.astro`;
  - `src/pages/api/auth/{confirm,set-password,signin}.ts`;
  - `scripts/smoke.mjs`, `.github/workflows/ci.yml`.

  The post-deploy check in CI curls `$PROD_URL/auth/signin` and expects 2xx (`.github/workflows/ci.yml:108`). So if the plan made `/` the only sign-in route, `/auth/signin` would need to keep working or redirect, and those references would need updating.

- Sign-in error text: `signin.astro:6` shows the raw `?error=` query value in `ServerError`. Supabase error messages travel through the URL (`signin.ts:16`). This is review follow-up F9 (see Historical Context).

### 4. Test infrastructure

- **vitest.** `package.json` `"test": "vitest run"`. `vitest.config.ts` includes `src/**/*.test.ts` only, sets the `@` alias and `TZ: "Pacific/Honolulu"`, and runs in the node environment without jsdom or happy-dom. The 9 test files under `src/lib/` and `src/lib/services/` test schemas, helpers and mocked Supabase services. None renders an `.astro` page or React component, and none uses the Astro Container API. This research did not check whether the Container API works with Astro 7 and the Cloudflare adapter.
- **Browser / e2e.** No Playwright, Puppeteer or Cypress in `package.json` or `node_modules`. React islands (`client:load`) run in no test.
- **`scripts/smoke.mjs`**: dependency-free HTTP checks.
  - `request(path, { method, form, json, ... })` (lines 41-57) keeps a cookie jar, sends `Origin`, never follows redirects (`redirect: "manual"`) and returns `{status, location, body}`.
  - A step is `[name, fn, { status, location?, body? }]`, and `body` is a `[label, predicate]` pair. The runner is at lines 1233-1255.
  - Steps that touch `/` or sign-in:
    - "home renders": `GET /`, status 200, no body check (line 473).
    - anonymous redirect checks (lines 474-480).
    - "signin rejects wrong password" expects 302 to `/auth/signin?error=` (lines 482-486).
    - "signin accepts correct password" expects 302 to `/` (lines 487-491).
    - forgot-password POSTs (around lines 962-970).
    - the Mailpit reset-email round trip (around lines 1175-1221).
  - No step GETs the `/auth/signin` or `/auth/forgot-password` page, and no step checks the links rendered in any page body. These are the sub-agent's findings from reading the runner and step list; lines 473-491 were verified directly.
- **CI** (`.github/workflows/ci.yml`):
  - The `smoke` job runs `npm run preview` and waits with `curl -sf http://localhost:4321/` (lines 67, 79). `/` must therefore keep answering anonymous visitors with 2xx or 3xx (`curl -f` fails only on 4xx/5xx).
  - The job then runs `npm run smoke`.
  - The `deploy` job's post-deploy checks curl `/auth/signin` (line 108) and POST `/api/auth/signin` (line 112). Neither checks `/`.
- **Implication for the DoD test** (inference). Smoke can cover the server side of both paths:
  - `GET /` shows the sign-in form (`action="/api/auth/signin"`) and the forgot-password link;
  - sign-in from that form ends at `/dashboard`;
  - the forgot-password link target answers 200, and the reset POST answers `?sent=1`.

  It cannot exercise client-side validation or prove the page "looks finished". A browser test would need new tooling, and the old "S-09 introduces browser tests" note is the only source for that expectation.

## Code References

- `src/pages/index.astro:1-8`: current `/`, renders `Welcome`
- `src/components/Welcome.astro:5-106`: starter hero, cosmic styling, feature cards
- `src/components/Topbar.astro:1-30`: signed-in/anonymous top bar, used only by Welcome
- `src/styles/global.css:113-115`: `bg-cosmic` utility, used only by Welcome
- `src/layouts/Layout.astro:10`: default title "10x Astro Starter"
- `src/pages/auth/signin.astro:6-22`: sign-in card layout; raw `?error=` passed to the form
- `src/components/auth/SignInForm.tsx:45,88-92`: form action; forgot-password link and wording
- `src/pages/auth/forgot-password.astro:11-34`: matching card, `buttonVariants` link pattern
- `src/pages/api/auth/signin.ts:9-19`: sign-in redirects (error to `/auth/signin?error=`, success to `/`)
- `src/pages/api/auth/signout.ts:9`: sign-out redirects to `/`
- `src/pages/api/auth/set-password.ts:97`: successful set-password redirects to `/dashboard`
- `src/middleware.ts:4,26-30`: protected routes; anonymous visitors sent to `/auth/signin`
- `src/pages/dashboard.astro:97-115`: signed-in page shell and header
- `scripts/smoke.mjs:41-57,473-491,1233-1255`: request helper, home/sign-in steps, runner
- `.github/workflows/ci.yml:67,79,108,112`: preview wait on `/`, post-deploy sign-in checks

## Architecture Insights

- Auth pages are `.astro` shells around React form islands that POST native forms to `src/pages/api/auth/*`. Errors come back through redirect query strings. `/` can reuse `SignInForm` as it is.
- Styling follows the token rule. The precedent for links styled as buttons in `.astro` is `buttonVariants(...)` on a plain `<a>` (`forgot-password.astro:27`), not `asChild`.
- Supabase reads the session on every request in middleware, so a page can branch on `Astro.locals.user` (for example, redirect to `/dashboard`) without its own Supabase call.

## Historical Context (from prior changes)

- `context/archive/2026-09-29-initial-ui-setup/plan.md:38`: Welcome, Topbar and signup were left un-restyled because "S-09 replaces `/`". `bg-cosmic` stays only because Welcome uses it. Supported: `bg-cosmic` is still used only there.
- `context/archive/2026-09-29-initial-ui-setup/plan.md:42` and `plan-brief.md:34`: "S-09 introduces browser tests". This was a plan-time expectation, not a roadmap requirement. The roadmap and issue only require "an automated test" (`roadmap.md:241`, issue #18 DoD). Current state: no browser tooling exists.
- `context/archive/2026-09-29-initial-ui-setup/follow-ups/review-fixes.md`, F9 (unchecked): the sign-in page shows raw `?error=` text. The suggested fix is error codes mapped to fixed messages, which "fits S-04 or S-09". Supported as still open: `signin.ts:16` and `signin.astro:6` are unchanged in substance.
- Same file, F7 (unchecked): the config banner's destructive `Alert` lacks a tinted background. Suggested for `/10x-ui`.
- `context/archive/2026-10-02-recency-annotated-plan/reviews/impl-review-phase-2.md:74-83`, F5: `RecencyNote` uses green `text-primary`. Deferred to S-09's `/10x-ui` pass with a neutral `--info` token, recorded as a comment on issue #18. This is dashboard styling, not part of the sign-in page.
- `context/archive/2026-10-04-password-reset/plan.md:46` and `plan-brief.md:39`: S-05 made "no restyle of the auth pages or landing page (S-09)". New auth pages follow the sign-in card layout.
- `context/archive/2026-10-04-invite-on-first-delivery/reviews/impl-review.md:35`: the sign-in link was briefly "Forgot password?" and was then reverted to "Forgot or never set a password?". That wording covers accounts whose invitation email failed. The earlier plan and roadmap handoff text that say "Forgot password?" are superseded by this revert for the link label. The S-09 outcome's "forgot password" is generic, not a label.
- `context/archive/2026-10-04-invite-on-first-delivery/plan.md:114-118`: S-04 removed `/auth/signup`, `/api/auth/signup` and `/auth/confirm-email`. The "no sign-up link" constraint is already met in code. Nothing under `src/` links to `/auth/signup` (inspected: the 10 files referencing auth paths above).

## Related Research

- `context/archive/2026-09-29-initial-ui-setup/research.md`: the original UI token/shadcn setup, including the note on `Layout.astro`'s default title.
- `context/archive/2026-10-04-password-reset/`: the reset flow that the "forgot password" path from `/` enters.

## Open Questions

These are product and scope choices for `/10x-plan`; the code does not settle them.

1. **`/` for a signed-in visitor**: redirect to `/dashboard`, or something else? Linked to whether `signin.ts:19` should redirect to `/dashboard` directly.
2. **`/` vs `/auth/signin`**: render the sign-in card at both, make one redirect to the other, or keep `/` as a separate entry page that links to `/auth/signin`? Constraints: the 22 `/auth/signin` references, the CI post-deploy curl (`ci.yml:108`) and the middleware redirect.
3. **Test form**: extend `scripts/smoke.mjs` (no new tooling; server-rendered HTML and redirects only), or introduce Playwright as the old initial-ui-setup note expected (new dependency and CI setup)?
4. **Deferred items in scope?** F9 (error codes instead of raw `?error=`), the `--info` token for `RecencyNote` (#18 comment), F7 banner tint, `Layout` default title, and removing `Welcome`/`Topbar`/`bg-cosmic` plus updating CLAUDE.md's legacy-exception line.
5. **Page content beyond the form**: the roadmap rules out pitch copy. Whether the card shows the product name "Meal Orchestrator" (no page shows it as a heading today) is a design choice for the plan or `/10x-ui`.
