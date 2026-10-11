# Critical-journey e2e as a CI gate (S-04) Implementation Plan

## Overview

One real-browser Playwright journey on the Workers preview covers delivery → invitation → set password → dashboard → keep picks → swap → rate → sign out → sign in again → choices still there (test-plan risk #4, and the invitation half of #7). It runs as a separate, required `e2e` CI job that `deploy` waits for. A fixture helper makes the e2e independent of the calendar and of any hand-made user, so the existing `setup` project and seed spec also run in CI on an empty stack.

## Current State Analysis

- Playwright is set up on this branch, uncommitted (`/10x-e2e-setup`): `playwright.config.ts` (build + preview `webServer` on `E2E_PORT`, default 4321; a `setup` project; `chromium` with `storageState`; `retries: 2`, `workers: 1` in CI; trace `on-first-retry`), `tests/e2e/auth.setup.ts` (signs in `E2E_USERNAME`/`E2E_PASSWORD`, retrying around the React hydration race), `tests/e2e/seed.spec.ts` (read-only dashboard check), `.playwright/cli.config.json`, `.gitignore`/`.env.example` entries, `@playwright/test` 1.64.0, `context/foundation/test-stack.md`.
- The seed depends on a user created by hand (`e2e-test@example.com`). Its only upcoming week (Mon 2026-10-12) starts on 2026-10-12, after which "Next week" has no radios and the seed fails. CI has no such user at all.
- CI (`.github/workflows/ci.yml`) has no Playwright. The `smoke` job shows how to start Supabase with Mailpit, write `.env`/`.dev.vars` and preview on 4321. Its keep-alive failure step and the replay step make it a bad host for more steps (research §CI wiring).
- Nothing in the app changes: this plan adds tests, a CI job and docs.

## Desired End State

- `npx playwright test` passes on any date, against a local stack where neither the e2e user nor the journey user exists yet, and passes again when re-run immediately.
- The journey spec drives every step of risk #4 in Chromium against the Workers preview, for a new user each run, and reads the real invitation email from Mailpit.
- On every PR that changes code, a CI job `e2e` runs the suite; `deploy` needs it; it is a required status check on `master`; a failure uploads the Playwright report with a trace.
- `docs/testing.md`, the test plan (§3 row 4, §4, §5, §6.4, §6.5) and `context/foundation/test-stack.md` describe the e2e as it is.

### Key Discoveries:

- Swap and save work only on an upcoming week (`week_start` after today, `docs/api.md:86`); rating only on the chosen option with `today-7 ≤ meal_date ≤ today` (`src/lib/ratings.ts:36-38`, faces only then, `MealSlot.astro:34,58`). So the journey user needs two deliveries: this week's (rate) and next week's (swap/save). A first delivery of a started week is stored (`docs/api.md:48`); this week's Monday is always in the rating window.
- "Keep these picks" shows only while the week is unsaved (`UpcomingWeekEditor.tsx:180`), and a swap also saves. The journey therefore keeps the picks first, then swaps.
- The invitation link is `{{ .SiteURL }}/auth/set-password?token_hash=…&type=invite` (`supabase/templates/invite.html`), and `site_url = "http://localhost:4321"` (`supabase/config.toml:154`). Locally the e2e previews on 4322, so the helper keeps the link's path and query and swaps in `baseURL`'s origin.
- **The 2-emails-per-hour budget doesn't apply locally or in CI** (this corrects research finding 2). `[auth.rate_limit] email_sent = 2` takes effect only with custom SMTP (`config.toml:181`). The running auth container has `GOTRUE_RATE_LIMIT_EMAIL_SENT=360000` and Mailpit SMTP, and CI uses the same CLI. So retries and repeated local runs need no email handling.
- `todayInWarsaw(now)` in `src/lib/plans.ts:25` is pure (no `astro:env`) and can be imported from the e2e helper through the `@/*` alias, so the e2e uses the same "today" as the dashboard.
- Smoke's admin/Mailpit calls (`scripts/smoke.mjs:422-450`, `526-558`) are the shapes to port: `POST /auth/v1/admin/users`, `GET $MAILPIT_URL/api/v1/search?query=to:"…"`, then `/api/v1/message/<ID>`.
- Sign-out is a plain form button "Sign out" on the dashboard (`src/pages/dashboard.astro:109-112`); set password uses the label "New password" and the button "Save password" (`SetPasswordForm.tsx:59,83`); rating faces are buttons with `aria-label` from `RATING_FACES` and `aria-pressed` (`MealRating.tsx`, `src/lib/ratings.ts:20-24`).

## What We're NOT Doing

- No app code, migration or `supabase/config.toml` change (no local `site_url` change, no rate-limit change).
- Not re-checking in the browser the rules pgTAP and smoke already cover (cut-off boundaries, rating window edges, re-send rules, expired/used links, isolation). The journey covers only what needs a browser: hydration, optimistic UI, the cookie session.
- No admin-API fallback for the invitation: the journey always reads the real email; no email within the timeout is a failure.
- No other browsers (Firefox/WebKit), no visual or snapshot tests (test-plan §7), no Playwright browser caching in CI.
- No change to the `smoke` job.

## Implementation Approach

Build bottom-up so each phase is verifiable on its own: (1) helpers plus a self-provisioning `setup`, so the existing seed passes on an empty stack; (2) the journey on top of the same helpers, green locally; (3) the CI job, the gate wiring and the docs. The journey spec is a single `test` split into `test.step`s, runs in a fresh browser context without the stored session, and uses a unique email per run (`e2e-journey-<timestamp>@example.com`), so no reset between runs is needed. Selectors are role/label based.

## Critical Implementation Details

- **Timing & lifecycle**: in CI, `.env` and `.dev.vars` must be written before Playwright starts, because its `webServer` runs `npm run build` and the build reads them. The preview must run on 4321 in CI (leave `E2E_PORT` unset) so the invitation link host already matches. `npm run preview` is started by Playwright, not by a background `&` step.
- **State sequencing**: within the journey, deliver this week first (that delivery creates the account and sends the invitation), then next week. Click "Keep these picks" before swapping, since the button disappears once the week is saved.

## Phase 1: Fixture helper and self-provisioning setup

### Overview

Shared e2e helpers that deliver weeks relative to today in Warsaw, provision a user with a password, and read an invitation from Mailpit. The `setup` project uses them, so the seed runs on any date and on an empty stack (CI). Commit the existing Playwright setup with this phase.

### Changes Required:

#### 1. Week dates and delivery

**File**: `tests/e2e/support/deliveries.ts` (new)

**Intent**: Build a contract-valid delivery for a given email and target Monday by shifting every date in `scripts/fixtures/mo-delivery.sample.json` by the day delta from its `week_start`, and POST it to the app.

**Contract**: `thisMonday(today)` / `nextMonday(today)` take a Warsaw `YYYY-MM-DD` (from `todayInWarsaw(new Date())`); this week's Monday is today when today is a Monday, and next week's is the following Monday. `deliverWeek(request, { email, weekStart })` posts to `/api/mo/deliveries` with `Authorization: Bearer ${MO_INGEST_TOKEN}` and expects 2xx, failing with the response body otherwise. A unique `run_id` per call. Date arithmetic in UTC on date-only strings (no local time zone).

#### 2. User provisioning

**File**: `tests/e2e/support/users.ts` (new)

**Intent**: Idempotently make sure an account exists with a known password, through the GoTrue admin API, so the `setup` user works on a fresh stack and on a stack where it already exists.

**Contract**: `ensureUserWithPassword(email, password)` only touches the auth user; delivering weeks is the caller's job. Look the user up (admin users list filtered by email), then `PUT /auth/v1/admin/users/<id>` with `password` and `email_confirm: true`; if it doesn't exist, `POST /auth/v1/admin/users` with the same fields. Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Throws with the status and body on any non-2xx.

#### 3. Mailpit invitation

**File**: `tests/e2e/support/mailpit.ts` (new)

**Intent**: Wait for the invitation email to an address and return its set-password link, re-hosted on the test's `baseURL`.

**Contract**: `readInvitationLink(email, baseURL)` polls `GET ${MAILPIT_URL}/api/v1/search?query=to:"<email>"` (default `MAILPIT_URL` `http://127.0.0.1:54324`, as in smoke) for up to ~15 s, reads the newest message, extracts the `/auth/set-password?token_hash=…&type=invite` href, and returns `baseURL` + that path and query. Times out with a message naming the email and Mailpit URL.

#### 4. Self-provisioning setup

**File**: `tests/e2e/auth.setup.ts`

**Intent**: Before signing in, deliver next week for `E2E_USERNAME` (creating the account on a fresh stack) and then set its password with `ensureUserWithPassword`, so the stored session always has an upcoming week with radios.

**Contract**: The same output `playwright/.auth/user.json`; the hydration-retry sign-in stays. Re-running on the same day sends an identical delivery (a no-op re-send). The seed spec is unchanged apart from its comment, if needed.

**Addendum (implementation, 2026-10-11)**: "identical" includes `run_id` (`docs/mo-delivery-contract.md`, `docs/api.md:48`), so a unique `run_id` per call and a no-op re-send can't both hold. `deliverWeek` takes an optional `runId` (default unique, `e2e-<uuid>`); `setup` passes `e2e-setup-<weekStart>`, so any re-run in the same week is a no-op re-send rather than a replacement of next week's options.

#### 5. Config and env

**Files**: `playwright.config.ts`, `.env.example`, `package.json`

**Intent**: Document the new variables and add a script.

**Contract**: `.env.example` gains `MAILPIT_URL=` (optional) beside the existing `E2E_*`. `package.json` gains `"test:e2e": "playwright test"`. Config changes for CI come in Phase 3.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests unaffected: `npm test`
- Setup and seed pass locally on preview :4322: `npx playwright test`
- Setup and seed pass a second time right away (idempotent provisioning): `npx playwright test`

#### Manual Verification:

- Delete the `E2E_USERNAME` user in Studio (or use a new `E2E_USERNAME`), re-run `npx playwright test`, and it passes, which shows the empty-stack case works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Critical-journey spec

### Overview

The one journey of risk #4, for a new user each run, in a browser context without the stored session.

### Changes Required:

#### 1. Journey spec

**File**: `tests/e2e/critical-journey.spec.ts` (new)

**Intent**: Prove the interactive journey works in a real browser on the Workers runtime. It asserts only what needs a browser (hydrated islands, optimistic save status, rating toggles, cookie session across sign-out/sign-in).

**Contract**: `test.use({ storageState: { cookies: [], origins: [] } })`; one `test` with `test.step`s:

1. **Delivery**: `deliverWeek` for `e2e-journey-<Date.now()>@example.com`, this week, then next week.
2. **Invitation**: `readInvitationLink`, then `page.goto` it.
3. **Set password**: fill "New password" (meets `password-rules`), "Save password", retrying around hydration like `auth.setup.ts`; lands on the dashboard ("Your meals" heading, no "Something went wrong").
4. **Keep picks**: "Next week" tab, "Keep these picks", and the status reads "Saved … · Editable until …".
5. **Swap**: in a slot with an unchecked radio, check it; the radio is checked and the status still reads "Saved …". Remember the meal's name.
6. **Rate**: "This week" tab; on Monday's chosen meal, press a face (e.g. "Tasty"); its `aria-pressed` becomes `true`.
7. **Sign out**: "Sign out" lands on the sign-in page; `/dashboard` now redirects to `/auth/signin`.
8. **Sign in again**: email + the new password (hydration retry), back on the dashboard.
9. **Choices still there**: under "Next week" the swapped radio is still checked and the status still reads "Saved"; under "This week" the face is still pressed.

If the sign-in retry block is needed in both specs, extract it to `tests/e2e/support/auth.ts` and use it from `auth.setup.ts` too.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Journey passes locally: `npx playwright test tests/e2e/critical-journey.spec.ts`
- Full suite passes twice in a row with no cleanup in between: `npx playwright test`

#### Manual Verification:

- Break one step on purpose (e.g. change the expected face label) and confirm the failure names the step and leaves a trace in `playwright-report/`; then revert
- `npx playwright show-report` shows the steps as readable `test.step` names

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: CI gate and docs

### Overview

A separate `e2e` job gated like smoke, required on `master` and before deploy, plus docs that describe the e2e as it is.

### Changes Required:

#### 1. CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the Playwright suite on every code PR and master push, against its own local Supabase (with Mailpit) and a Workers preview on 4321.

**Contract**: New job `e2e` with `needs: changes` and the same fail-closed `if` as `smoke`. Job `env`: `MO_INGEST_TOKEN` (test-only, as in smoke), fixed test `E2E_USERNAME`/`E2E_PASSWORD`, `CI` (set by Actions). Steps: checkout, setup-node 22 with npm cache, `supabase/setup-cli@v3`, `npm ci`, start Supabase with smoke's `-x` exclusions (Mailpit on), write `.env` (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MO_INGEST_TOKEN`, `MAILPIT_URL`, falling back to `INBUCKET_URL` as smoke does) and copy it to `.dev.vars`, `npx playwright install --with-deps chromium`, `npx playwright test`; on failure upload `playwright-report/` (and `test-results/`) with `actions/upload-artifact`; `supabase stop --no-backup` under `if: always()`. `deploy.needs` becomes `[ci, smoke, e2e]`.

#### 2. Playwright CI settings

**File**: `playwright.config.ts`

**Intent**: Fit the CI decisions: one retry, a trace on every failure, a report CI can upload.

**Contract**: `retries: process.env.CI ? 1 : 0`; `trace: "retain-on-failure"`; reporter `html` with `open: "never"` (plus `github` in CI for annotations). `workers: 1` in CI stays.

#### 3. Required check

**Where**: GitHub branch protection for `master` (no file)

**Intent**: Make the e2e a gate, as test-plan §5 requires after Phase 4.

**Contract**: After the first green `e2e` run on the PR, add `e2e` to `master`'s required status checks via `gh api` (read the current protection first, then add without removing existing checks). Confirm with the user before changing it.

#### 4. Docs

**Files**: `docs/testing.md`, `context/foundation/test-plan.md`, `context/foundation/test-stack.md`, `README.md`

**Intent**: Describe the e2e as it is now (CLAUDE.md: a changed CI step updates its doc in the same PR).

**Contract**:

- `docs/testing.md`: new "E2E" section (what the journey covers and doesn't, local run on :4322 with `.env` variables, the helpers, that the invitation link host is rewritten to `baseURL`, that local and CI auth email isn't rate limited) and an `e2e` bullet under "CI" (job, `deploy` needs it, required check, report artifact on failure).
- Test plan: §3 row 4 status and change folder; §4 e2e row (Playwright 1.64.0, checked date); §5 e2e gate "required"; §6.4 cookbook (add a step to the journey vs. a new spec, reuse `support/` helpers, new users per run, role/label selectors, never re-check pgTAP rules); §6.5 Phase 4 note.
- `test-stack.md` `## E2E`: seed is self-provisioning; add the journey spec, `MAILPIT_URL`, the CI job; `updated:` date.
- `README.md`: `npm run test:e2e` row in Scripts.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Full local suite still passes with the new config: `npx playwright test`
- The PR's CI run shows `e2e` green alongside `ci` and `smoke`: `gh pr checks`
- `deploy` lists `e2e` in `needs` (checked in the workflow diff)

#### Manual Verification:

- `e2e` appears in `master`'s required status checks (`gh api repos/{owner}/{repo}/branches/master/protection`)
- A deliberately failing commit on the PR (or a re-run with a broken assertion) fails `e2e` and the uploaded report opens with a trace; then revert
- Docs read correctly: `docs/testing.md` E2E section, test-plan §3/§4/§5/§6.4/§6.5, `test-stack.md`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None added: the helpers are test code exercised by every e2e run. Vitest's `include` (`src/**`, `scripts/**`) already keeps `tests/e2e` out of `npm test`.

### Integration Tests:

- `setup` + seed: a provisioned user's signed-in dashboard renders an upcoming week and survives a reload.
- Journey: the nine steps above, on a new user each run.

### Manual Testing Steps:

1. Empty-stack run: remove the `E2E_USERNAME` user, run `npx playwright test`, and it passes.
2. Broken-step run: confirm a failure names its step and leaves a trace.
3. CI: a failing `e2e` blocks the PR and uploads a usable report.

## Performance Considerations

The `e2e` job adds a second Supabase start and a Chromium install (each roughly a minute or two) and runs in parallel with `smoke`, so the wall-clock time per PR grows by at most the difference between the two jobs. Not yet measured; record the first run's duration in test-plan §6.5.

## Migration Notes

None: no schema or app change. The manually created `e2e-test@example.com` stays usable locally (`setup` now re-provisions whatever `E2E_USERNAME` names).

## References

- Research: `context/changes/testing-critical-journey-e2e/research.md` (finding 2, the email budget, is corrected above)
- Issue: #122 (S-04); phase sub-issues: #131 (Phase 1), #132 (Phase 2), #133 (Phase 3), chained by "Blocked by"
- Test plan: `context/foundation/test-plan.md` §2 risks #4, #7; §3 Phase 4; §5
- Smoke helpers to port: `scripts/smoke.mjs:422-450`, `526-558`
- Existing setup: `playwright.config.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/seed.spec.ts`, `context/foundation/test-stack.md`
- CI pattern: `.github/workflows/ci.yml` `smoke` job

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fixture helper and self-provisioning setup

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 90a7b2d
- [x] 1.2 Type check passes: `npx astro check` — 90a7b2d
- [x] 1.3 Unit tests unaffected: `npm test` — 90a7b2d
- [x] 1.4 Setup and seed pass locally on preview :4322: `npx playwright test` — 90a7b2d
- [x] 1.5 Setup and seed pass a second time right away (idempotent provisioning): `npx playwright test` — 90a7b2d

#### Manual

- [x] 1.6 Delete the `E2E_USERNAME` user in Studio (or use a new `E2E_USERNAME`), re-run `npx playwright test`, and it passes, which shows the empty-stack case works — 90a7b2d

### Phase 2: Critical-journey spec

#### Automated

- [x] 2.1 Lint passes: `npm run lint`
- [x] 2.2 Type check passes: `npx astro check`
- [x] 2.3 Journey passes locally: `npx playwright test tests/e2e/critical-journey.spec.ts`
- [x] 2.4 Full suite passes twice in a row with no cleanup in between: `npx playwright test`

#### Manual

- [x] 2.5 Break one step on purpose (e.g. change the expected face label) and confirm the failure names the step and leaves a trace in `playwright-report/`; then revert
- [x] 2.6 `npx playwright show-report` shows the steps as readable `test.step` names

### Phase 3: CI gate and docs

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Full local suite still passes with the new config: `npx playwright test`
- [ ] 3.3 The PR's CI run shows `e2e` green alongside `ci` and `smoke`: `gh pr checks`
- [ ] 3.4 `deploy` lists `e2e` in `needs` (checked in the workflow diff)

#### Manual

- [ ] 3.5 `e2e` appears in `master`'s required status checks (`gh api repos/{owner}/{repo}/branches/master/protection`)
- [ ] 3.6 A deliberately failing commit on the PR (or a re-run with a broken assertion) fails `e2e` and the uploaded report opens with a trace; then revert
- [ ] 3.7 Docs read correctly: `docs/testing.md` E2E section, test-plan §3/§4/§5/§6.4/§6.5, `test-stack.md`
