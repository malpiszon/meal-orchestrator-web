# Landing Page (S-09) Implementation Plan

## Overview

Replace the starter's "10x Astro Starter" page at `/` with a finished entry point. An anonymous visitor at `/` is redirected to the styled sign-in page, which now carries the Meal Orchestrator logo. A signed-in visitor goes straight to `/dashboard`. Sign-in lands on `/dashboard`, sign-in errors become fixed messages instead of reflected query text (review follow-up F9), the favicon and default page title stop being the starter's, and `scripts/smoke.mjs` covers both Definition-of-done paths: `/` → sign in → dashboard, and `/` → "forgot password" → reset request.

## Current State Analysis

- `/` renders `Welcome.astro` (`src/pages/index.astro:1-8`): cosmic background, `Topbar`, "10x Astro Starter" hero, starter feature cards, all with hard-coded palette colours. `Welcome` and `Topbar` are imported nowhere else; `bg-cosmic` (`src/styles/global.css:113-115`) is used only by `Welcome`.
- The look to match already exists: `src/pages/auth/signin.astro:9-22` is a centred shadcn `Card` on `bg-background` with `SignInForm`, which already links to "Forgot or never set a password?" (`src/components/auth/SignInForm.tsx:88-92`).
- A successful `POST /api/auth/signin` redirects to `/` (`src/pages/api/auth/signin.ts:19`). Errors redirect to `/auth/signin?error=<Supabase error.message>` (`signin.ts:11,16`), and `signin.astro:6` shows that raw text (F9, `context/archive/2026-09-29-initial-ui-setup/follow-ups/review-fixes.md:5`).
- Sign-out redirects to `/` (`src/pages/api/auth/signout.ts:9`). Set-password already redirects to `/dashboard` (`src/pages/api/auth/set-password.ts:97`).
- `Layout.astro:10` defaults the title to "10x Astro Starter"; `index.astro` passes none. `public/favicon.png` is the starter's 32×32 icon.
- The supplied logo `mo_logo.png` (repo root, untracked) is 200×200 RGBA with a transparent background. It includes the "MEAL ORCHESTRATOR" wordmark, and its white outline keeps it legible on the dark theme's `--background` (checked by flattening it onto a dark colour).
- Tests: vitest covers `src/**/*.test.ts` only (pure lib code). No browser tooling. `scripts/smoke.mjs` is the HTTP harness CI runs against the production preview. "home renders" expects `GET /` 200 (`scripts/smoke.mjs:473`), "signin accepts correct password" expects 302 to `/` (`:487-491`), and two steps expect `location` to start with `/auth/signin?error=` (`:485`, `:1054`). Location checks are prefix matches (`:1244`).
- CI: the smoke job waits on `curl -sf http://localhost:4321/` (`.github/workflows/ci.yml:67,79`); a 302 passes (`-f` only fails on ≥400). The post-deploy job curls `/auth/signin` (2xx) and greps the sign-in error redirect for `Invalid%20login%20credentials` (`ci.yml:108-114`).

## Desired End State

- `GET /` answers 302: to `/auth/signin` for an anonymous visitor, to `/dashboard` for a signed-in one. Nothing renders at `/` itself, and no starter content exists in the codebase.
- `GET /auth/signin` shows the logo above the "Sign in" card for anonymous visitors and redirects signed-in visitors to `/dashboard`. No page links to `/auth/signup`.
- Successful sign-in answers 302 to `/dashboard`. A failed sign-in answers 302 to `/auth/signin?error=<code>`, and the page shows a fixed message for that code.
- The browser tab shows the logo icon. Pages without their own title show "Meal Orchestrator".
- Smoke covers both DoD paths and runs green in CI. CI's post-deploy check expects the new error code.

### Key Discoveries:

- `Astro.locals.user` is resolved by middleware on every non-machine request (`src/middleware.ts:15-24`), so `index.astro` and `signin.astro` can branch without their own Supabase call.
- The precedent for a button-styled link in `.astro` is `buttonVariants(...)` on a plain `<a>` (`src/pages/auth/forgot-password.astro:27`). The plan adds no new links of that kind.
- `@supabase/auth-js` exposes `error.code` values `invalid_credentials`, `over_request_rate_limit` and `email_not_confirmed` (`node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts`).
- An account a delivery created has no password, so its sign-in attempts fail with `invalid_credentials`. The "Forgot or never set a password?" link covers that case.

## What We're NOT Doing

- No sign-in form rendered at `/` itself, and no change to the `/auth/signin` URL. `/` only redirects (user decision).
- No logo on forgot-password, set-password, dashboard or history pages. The app-wide logo/visual-identity pass stays parked (`context/foundation/roadmap.md`, "General mo-web UI review").
- No `--info` token for `RecencyNote` (issue #18 comment) and no F7 banner tint. Both are left for the `/10x-ui` polish pass.
- No Playwright or other browser tests. Client-side validation and visuals are checked manually.
- No change to the sign-out target (`/`, which now forwards to `/auth/signin`), the forgot-password or set-password flows, or their error handling.
- No pitch or marketing copy. The logo's wordmark is the only product name on the page.
- No migration, no Supabase stack restart (shared local stack, `CLAUDE.local.md`).
- `public/template.png` (README screenshot) stays untouched.

## Implementation Approach

`index.astro` becomes a two-way redirect. The logo becomes a static file in `public/` rendered by a plain `<img>` with explicit `width`/`height`. That avoids Astro's image service, which needs sharp at runtime and isn't available on Workers. The favicon and apple-touch icon are generated once from `mo_logo.png` with the already-installed `sharp` in a scratch script; the generated PNGs are committed and the script is not. F9 moves error wording out of the URL: a small pure helper in `src/lib/` maps a Supabase auth error to one of four codes and a code to its message, which the API and the page share and vitest covers. Smoke expectations change in the same phase as the behaviour they check, so every phase leaves CI green. Phase 3 then adds the DoD path steps.

## Phase 1: Entry point and branding

### Overview

`/` redirects, sign-in lands on the dashboard, the sign-in card shows the logo, the favicon and default title are the product's, and the starter page and its legacy styling exception are gone.

### Changes Required:

#### 1. Logo and icons

**File**: `public/logo.png`, `public/favicon.png`, `public/apple-touch-icon.png`; delete `mo_logo.png` from the repo root

**Intent**: Ship the supplied logo as a static asset, and replace the starter favicon with icons derived from it. The full logo with its wordmark is unreadable at 32px, so the favicon is cropped to the robot head.

**Contract**: `public/logo.png` is the 200×200 logo (losslessly recompressed with sharp is fine; no upscaling). `public/favicon.png` is 32×32, cropped to the robot head, transparent background. `public/apple-touch-icon.png` is 180×180, the full logo flattened onto white (iOS renders transparency as black). Generated once with `sharp` from a scratchpad script that is not committed. `mo_logo.png` is removed from the root once `public/logo.png` exists.

#### 2. Layout defaults

**File**: `src/layouts/Layout.astro`

**Intent**: Stop showing the starter name in the tab, and offer the touch icon.

**Contract**: default `title` becomes `"Meal Orchestrator"`; add `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` next to the existing favicon link.

#### 3. `/` becomes a redirect

**File**: `src/pages/index.astro`

**Intent**: Replace the Welcome page with the entry-point logic.

**Contract**: frontmatter only: `Astro.locals.user` → `Astro.redirect("/dashboard")`, otherwise `Astro.redirect("/auth/signin")` (302 both). No markup, no `Layout`.

#### 4. Sign-in page: logo and signed-in redirect

**File**: `src/pages/auth/signin.astro`

**Intent**: Make the sign-in page the finished entry point, and stop showing a form to someone already signed in.

**Contract**: a signed-in visitor gets `Astro.redirect("/dashboard")`. Above the `Card`, inside the same centred column, an `<img src="/logo.png" alt="Meal Orchestrator" width="128" height="128">` centred (layout classes only, no colour classes). The card's `<h1>Sign in</h1>` and `SignInForm` stay as they are. The column must stack logo and card vertically (e.g. `flex-col` with a gap) without changing the card width.

#### 5. Sign-in success target

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Land the user on their dashboard directly (US-03), as set-password already does.

**Contract**: success redirect `"/"` → `"/dashboard"`. Error redirects unchanged in this phase.

#### 6. Remove starter code

**File**: delete `src/components/Welcome.astro`, `src/components/Topbar.astro`; `src/styles/global.css`

**Intent**: The starter page is gone; its only-used-here styling goes with it.

**Contract**: both components deleted; the `bg-cosmic` utility (`global.css:113-115`) removed. `grep -rn "Welcome\|Topbar\|bg-cosmic\|10x Astro Starter" src/` returns nothing.

#### 7. Retire the legacy styling exception

**File**: `CLAUDE.md`, `AGENTS.md`

**Intent**: The token rule's legacy exceptions all point to deleted files.

**Contract**: remove the sentence "Legacy exceptions until S-09/S-04: `Welcome.astro`, `Topbar.astro`, `signup.astro`." from the styling hard rule in both files; the rest of the rule is unchanged.

#### 8. Keep smoke green

**File**: `scripts/smoke.mjs`

**Intent**: Existing steps encode the old behaviour of `/` and of the sign-in redirect.

**Contract**: "home renders" becomes "home redirects anonymous user to sign-in" (`GET /` → 302, location `/auth/signin`). "signin accepts correct password" expects 302 to `/dashboard`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Type and template check passes: `npx astro check`
- Build passes: `npm run build`
- No starter leftovers: `grep -rn "Welcome\|Topbar\|bg-cosmic\|10x Astro Starter\|auth/signup" src/` prints nothing
- Smoke passes against the preview on :4322: `npm run build && npx astro preview --port 4322`, then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run smoke`

#### Manual Verification:

- Opening `/` signed out lands on `/auth/signin`, which shows the logo above the card, readable in both light and dark OS themes, with no layout shift as the image loads
- Signing in from there lands on `/dashboard`; opening `/` or `/auth/signin` while signed in lands on `/dashboard`
- The browser tab shows the robot-head favicon, and `/auth/signin` and other untitled pages show a product title, not "10x Astro Starter"
- The page reads well at phone width (≈375px): logo and card fit without horizontal scroll

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Fixed sign-in error messages (F9)

### Overview

The sign-in API stops reflecting Supabase's message in the URL. It redirects with one of four fixed codes, and the page shows a fixed message per code.

### Changes Required:

#### 1. Error code helper

**File**: `src/lib/signin-errors.ts` (new), `src/lib/signin-errors.test.ts` (new)

**Intent**: One place that turns a Supabase auth error into a code, and a code from the URL into user-facing text, shared by the API and the page and unit-tested.

**Contract**: codes `invalid_credentials`, `rate_limited`, `not_configured`, `sign_in_failed`. `signInErrorCode(error)`: Supabase `error.code === "invalid_credentials"` → `invalid_credentials`; `over_request_rate_limit` → `rate_limited`; anything else (including a missing code) → `sign_in_failed`. `signInErrorMessage(code: string | null)`: known code → fixed message; `null` or unknown → `null` (the page shows nothing). Messages:
- `invalid_credentials`: "Wrong email or password."
- `rate_limited`: "Too many sign-in attempts. Wait a minute and try again."
- `not_configured`: "Sign-in isn't configured on this server."
- `sign_in_failed`: "Couldn't sign you in. Try again in a moment."

Tests cover each mapping, a missing `error.code`, an unknown URL code and `null`.

#### 2. Sign-in API

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Redirect with a code, and keep the raw Supabase message for debugging in the Worker logs only.

**Contract**: not configured → `/auth/signin?error=not_configured`; auth error → `console.error` with the Supabase message and code, then `/auth/signin?error=<signInErrorCode(error)>`. Success unchanged (`/dashboard`).

#### 3. Sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Never render URL-supplied text.

**Contract**: `serverError` passed to `SignInForm` is `signInErrorMessage(Astro.url.searchParams.get("error"))`.

#### 4. Smoke and CI expectations

**File**: `scripts/smoke.mjs`, `.github/workflows/ci.yml`

**Intent**: The raw-text expectations no longer hold.

**Contract**: smoke "signin rejects wrong password" (`:482-486`) and "signin rejects the password from before the reset" (`:1052-1055`) expect location `/auth/signin?error=invalid_credentials`. Add a smoke step: `GET /auth/signin?error=<script>spoof</script>` → 200 and the body contains neither `spoof` nor any of the four fixed messages. Add one: `GET /auth/signin?error=invalid_credentials` → 200 and the body contains "Wrong email or password.". In `ci.yml` the post-deploy grep becomes `grep -q 'error=invalid_credentials'`, and its comment changes to say a missing-secrets deploy yields `error=not_configured`.

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `npm test` (includes `src/lib/signin-errors.test.ts`)
- Lint, check and build pass: `npm run lint && npx astro check && npm run build`
- Smoke passes against the preview on :4322 (same command as Phase 1), including the new error-message steps
- CI workflow still parses: `npx js-yaml .github/workflows/ci.yml > /dev/null`

#### Manual Verification:

- A wrong password shows "Wrong email or password." on the sign-in page, and the URL holds only `?error=invalid_credentials`
- Editing the URL to `?error=anything` shows no alert

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: DoD smoke coverage and docs

### Overview

Smoke walks both Definition-of-done paths starting at `/`, and the README describes the new entry point.

### Changes Required:

#### 1. Path steps in smoke

**File**: `scripts/smoke.mjs`

**Intent**: Prove from `/` that a user can sign in to the dashboard and can start a password reset, as the issue's DoD requires.

**Contract**: reuse `request()` and the step format. The step names make the two paths read as sequences ("landing: …").
- Anonymous, before the existing "signin rejects wrong password" step:
  - `GET /` → 302 `/auth/signin` (the Phase 1 step);
  - `GET /auth/signin` → 200. The body contains `src="/logo.png"`, `action="/api/auth/signin"` and `href="/auth/forgot-password"`. It contains neither `10x Astro Starter` nor `/auth/signup`;
  - `GET /auth/forgot-password` → 200 with the email form (`action="/api/auth/forgot-password"`);
  - `POST /api/auth/forgot-password` with a random unknown email → 302 `/auth/forgot-password?sent=1`.
- Signed in: the existing "signin accepts correct password" step (302 `/dashboard`, Phase 1) and the dashboard step after it form the sign-in path. Right after them, add:
  - `GET /` → 302 `/dashboard`;
  - `GET /auth/signin` → 302 `/dashboard`.

The reset request uses an unknown email on purpose. The route answers the same as for a real account (README: "answers the same whether or not the account exists"), and it sends no email. That keeps local Supabase's 2-emails-per-hour budget for the Mailpit step, which already proves a real reset email arrives.

#### 2. README

**File**: `README.md`

**Intent**: Document the entry point. Keep edits to S-09's own lines (the S-12 worktree also edits README).

**Contract**: the Auth routes table gets a `/` row ("Redirects to `/dashboard` when signed in, otherwise to `/auth/signin`"). The `/auth/signin` row mentions the logo, the signed-in redirect and the fixed error messages. The smoke section's opening step list adds the `/` and sign-in page checks. The project title "10x Astro Starter" at the top of README stays: renaming the README is outside S-09.

### Success Criteria:

#### Automated Verification:

- Smoke passes against the preview on :4322 with the new path steps, and with `MAILPIT_URL=http://127.0.0.1:54324` set the Mailpit reset step still passes
- Lint passes: `npm run lint` (smoke is `.mjs`; Prettier on the README via lint-staged at commit)

#### Manual Verification:

- In a browser, signed out: `/` → sign-in page → "Forgot or never set a password?" → submit email → "If an account exists…" message
- In a browser: `/` → sign in → dashboard

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `src/lib/signin-errors.test.ts`: each Supabase code mapping, missing code → `sign_in_failed`, each URL code → message, unknown or `null` → `null`.

### Integration Tests:

- `scripts/smoke.mjs` (CI `smoke` job, production preview): `/` redirects for anonymous and signed-in visitors; the sign-in page's content (logo, form action, forgot link, no starter text, no sign-up link); sign-in → `/dashboard`; forgot link → reset request `?sent=1`; error codes and the spoofing case.
- CI post-deploy: `/auth/signin` 2xx; the sign-in probe redirects with `error=invalid_credentials`.

### Manual Testing Steps:

1. Signed out, open `/`: land on `/auth/signin` with the logo; check light and dark OS themes and phone width.
2. Enter a wrong password: "Wrong email or password." appears.
3. Sign in: land on `/dashboard`. Open `/` and `/auth/signin`: both go to `/dashboard`.
4. Sign out: land on `/auth/signin`.
5. Follow "Forgot or never set a password?", submit an email: the "If an account exists…" message shows.
6. Check the tab favicon and title.

## Performance Considerations

`/` now costs one extra redirect hop for anonymous visitors. The logo is a ~50 KB static PNG served by Workers static assets with explicit dimensions, so it causes no layout shift.

## Migration Notes

None: no database change, no secrets. Deploy is the usual merge to `master`. The CI post-deploy grep and the API change ship in the same PR, so the post-deploy check runs against the matching Worker.

## References

- Related research: `context/changes/landing-page/research.md`
- Roadmap item: `context/foundation/roadmap.md` § S-09; issue #18
- Phase sub-issues: #96 (Phase 1), #97 (Phase 2), #98 (Phase 3)
- Card layout to match: `src/pages/auth/signin.astro:9-22`, `src/pages/auth/forgot-password.astro:11-34`
- F9: `context/archive/2026-09-29-initial-ui-setup/follow-ups/review-fixes.md:5`
- Smoke runner and steps: `scripts/smoke.mjs:41-57,470-491,1233-1255`
- CI checks: `.github/workflows/ci.yml:67,79,108-114`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Entry point and branding

#### Automated

- [x] 1.1 Lint passes
- [x] 1.2 Unit tests pass
- [x] 1.3 Type and template check passes
- [x] 1.4 Build passes
- [x] 1.5 No starter leftovers
- [x] 1.6 Smoke passes against the preview on :4322

#### Manual

- [x] 1.7 `/` signed out lands on sign-in with the logo, legible in light and dark
- [x] 1.8 Sign-in lands on dashboard; `/` and `/auth/signin` signed in go to dashboard
- [x] 1.9 Favicon and title are the product's
- [x] 1.10 Page reads well at phone width

### Phase 2: Fixed sign-in error messages (F9)

#### Automated

- [ ] 2.1 New unit tests pass
- [ ] 2.2 Lint, check and build pass
- [ ] 2.3 Smoke passes including the new error-message steps
- [ ] 2.4 CI workflow still parses

#### Manual

- [ ] 2.5 Wrong password shows the fixed message with only a code in the URL
- [ ] 2.6 An arbitrary `?error=` shows no alert

### Phase 3: DoD smoke coverage and docs

#### Automated

- [ ] 3.1 Smoke passes with the new path steps, Mailpit step included
- [ ] 3.2 Lint passes

#### Manual

- [ ] 3.3 Browser: `/` → forgot password → reset request message
- [ ] 3.4 Browser: `/` → sign in → dashboard
