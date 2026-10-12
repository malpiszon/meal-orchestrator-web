---
date: 2026-10-11T14:12:00+02:00
researcher: alan
git_commit: 3edeb5bde6c820c90562965092ee413ae0d8da70
branch: testing-critical-journey-e2e
repository: meal-orchestrator-web
topic: "S-04: what the critical-journey e2e (delivery → invitation → set password → dashboard → swap → save → rate → sign in again) needs to run as a CI gate"
tags: [research, e2e, playwright, ci, supabase, mailpit, fixtures]
status: complete
last_updated: 2026-10-11
last_updated_by: alan
---

# Research: critical-journey e2e as a CI gate (S-04)

**Date**: 2026-10-11 · **Branch**: testing-critical-journey-e2e · **Commit**: 3edeb5b (working tree has uncommitted Playwright setup)

## Research Question

Roadmap unknown (S-04): does Playwright run against the Workers preview in CI next to local Supabase and Mailpit, and how is the stack reset between runs? Plus the change note: what a fixture-helper phase must do (deliver a current upcoming week, create/set-password the user idempotently, also in CI).

## Summary

- The pieces exist but are not wired into CI. `playwright.config.ts` builds and previews on `E2E_PORT` and runs a `setup` project, then `chromium` with a saved `storageState` (`playwright.config.ts:20-42`). `.github/workflows/ci.yml` has no Playwright step; the `smoke` job already has local Supabase (with Mailpit on), a built `.env`/`.dev.vars`, and a preview on 4321 (`ci.yml:70-110`). The e2e fits there as a step, or a sibling job copying that setup.
- Reset strategy: no wipe is needed. Use a unique user email per run (smoke does this: `smoke-${Date.now()}@example.com`, `scripts/smoke.mjs:13`) and deliver fresh weeks relative to today. `npm run test:replay` wipes the DB, so it must stay last in the job (`ci.yml:112-118`).
- Three facts the plan must handle, none obvious from the setup:
  1. **Invitation link host.** `supabase/templates/invite.html` builds the link from `{{ .SiteURL }}`, and `supabase/config.toml:154` sets `site_url = "http://localhost:4321"`. An e2e preview on another port (the local default is 4322) gets a Mailpit link pointing at 4321. In CI the preview can run on 4321 (as smoke does), so the problem is local-only; the test can also rewrite the link's origin to `baseURL`, using only its `token_hash`/`type` query.
  2. **Email budget.** `[auth.rate_limit] email_sent = 2` per hour (`config.toml:182`). The delivery's first-time provisioning sends one invitation email (`src/pages/api/mo/deliveries.ts:111-113`). One journey run per Supabase stack is fine in CI (fresh stack per job); locally, repeated runs hit the limit, in which case the code falls back to `createUser` without an email (`deliveries.ts:121-131`) and the Mailpit step would fail with no email. Smoke notes the same budget (`smoke.mjs:616`).
  3. **Rating needs a started week.** Rating applies to the chosen option with `today-7 <= meal_date <= today` (`src/lib/ratings.ts:36-38`); faces render only then (`MealSlot.astro:34`, `rateable &&` at line 58). Swap/save apply only to an upcoming week (`week_start` after today, `docs/api.md:86`). So the journey needs two deliveries for the same user: one upcoming week (swap/save) and one current week (rate). A first delivery of a started week is stored (`docs/api.md:48`). The Monday meals of the current week are always inside the rating window, since the Monday is at most 6 days before today.
- Today's seed assertion is date-fragile as the change note says: it relies on a hand-made user with an upcoming week.

## Detailed Findings

### Existing e2e setup (on this branch, uncommitted)

- `tests/e2e/auth.setup.ts:5-30` signs in with `E2E_USERNAME`/`E2E_PASSWORD`, retries fill+submit until navigation (the sign-in form is a React island, so input typed before hydration is lost), and saves `playwright/.auth/user.json`.
- `tests/e2e/seed.spec.ts:6-20` is read-only: dashboard heading, "Next week" tab, first radio, no "Something went wrong", survives reload.
- `playwright.config.ts`: `workers: 1` and `retries: 2` in CI; `reuseExistingServer` outside CI; the `ASTRO_PREVIEW_BACKGROUND: "1"` env keeps preview in the foreground (comment at lines 38-39). The webServer command runs `npm run build && npm run preview -- --port ${PORT}`.
- Setup assumes a pre-existing user. The journey must instead start from a delivery, so it cannot share the `setup` project's `storageState` for its first half. Sign-in at the end ("sign in again") needs a fresh context without the stored state.

### Journey steps → what each depends on

| Step                | Mechanism (inspected)                                                                                                                                                                      | Source                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Delivery            | `POST /api/mo/deliveries` with `Authorization: Bearer $MO_INGEST_TOKEN`; zod `moDeliverySchema`; unknown user → `inviteUserByEmail`, then `app_metadata.provisioned_by`, then ingest again | `src/pages/api/mo/deliveries.ts:56-135`                          |
| Invitation          | Email in Mailpit, link `{{ .SiteURL }}/auth/set-password?token_hash=…&type=invite`; smoke reads it through `GET $MAILPIT_URL/api/v1/search?query=to:"…"` then `/api/v1/message/<ID>`       | `supabase/templates/invite.html`, `scripts/smoke.mjs:526-558`    |
| Set password        | Page checks the token read-only; React form `SetPasswordForm` posts to `/api/auth/set-password`; labels "New password", button "Save password"; minimum length from `password-rules`       | `src/pages/auth/set-password.astro:35-60`, `SetPasswordForm.tsx` |
| Dashboard           | Heading "Your meals", tabs ("This week" / "Next week"), radios in the editor                                                                                                               | `seed.spec.ts`, `UpcomingWeekEditor.tsx`                         |
| Swap                | Native `<input type=radio>` per option, saves on change via `/api/plans/choose`; status line becomes "Saved <time> · Editable until …"; inputs disabled while pending                      | `UpcomingWeekEditor.tsx:60-150`, `usePlanChoices.ts`             |
| Save ("Keep picks") | Button "Keep these picks" only while `savedAtLabel === null`; swapping also saves                                                                                                          | `UpcomingWeekEditor.tsx` (button block)                          |
| Rate                | `MealRating` island (`client:visible`): buttons `aria-label` = face label, `aria-pressed`; posts to `/api/ratings`                                                                         | `MealRating.tsx:23-50`, `MealSlot.astro:58`                      |
| Sign in again       | `/auth/signin` form (same hydration race the setup works around)                                                                                                                           | `auth.setup.ts:16-22`                                            |
| Choices still there | Reload: selected radio checked, face pressed                                                                                                                                               | `docs/dev-walkthrough.md` steps 5, 8                             |

### Fixture helper (change note's phase)

- **User creation.** Two options, both inspected. (a) Let the delivery create it (true to risk #4, which names invitation and set password) and read the invitation from Mailpit. (b) Skip email: call GoTrue admin `generate_link` for type `invite`/`recovery` (smoke does this, `smoke.mjs:422`) or `POST /auth/v1/admin/users` with `email_confirm: true` and a password (`smoke.mjs:439`, `docs/dev-walkthrough.md` step 2), which needs `SUPABASE_SERVICE_ROLE_KEY` and has no email budget. Risk #7's invitation-link property is already covered in smoke and pgTAP (`test-plan.md:64`), so the journey could use (a) for the one invite and (b) for the idempotent seed user that the `setup` project uses.
- **Idempotence.** The admin API returns `email_exists` for a duplicate (`deliveries.ts:10`); the helper should list/lookup by email first (`GET /auth/v1/admin/users`) or use a unique per-run email. A re-delivery of the same body is a no-op; a changed body for an upcoming week replaces options (`docs/api.md:48`), so a fixed email with weekly-relative dates is also safe locally.
- **Dates.** `start` must be a Monday after today in Europe/Warsaw; the walkthrough shifts every date in `scripts/fixtures/mo-delivery.sample.json` by the delta between its `week_start` (2026-06-29) and the target Monday (`dev-walkthrough.md` step 1). Smoke has its own helper computing "first Monday at least 7 days after today (UTC)" (`smoke.mjs:~140`). The e2e should compute dates with the Warsaw zone in TypeScript, not shell `date`. A current-week delivery uses the Monday of this week (today counts if Monday); a test run on a Sunday evening UTC vs Warsaw is a boundary the helper should compute from Warsaw, per risk #5's "Workers run in UTC" challenge.
- **Mutation caution.** Swap/save/rate mutate the same user; use a per-run user or tolerate a prior state (the radio chosen might already be the swap target).

### CI wiring (the roadmap unknown)

- Runner: `ubuntu-latest`; Node 22; `supabase/setup-cli@v3`; the smoke job starts Supabase with `-x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor` and leaves Mailpit on (`ci.yml:78-82`). The e2e needs Auth, PostgREST, Postgres, Mailpit: all remain.
- Preview on the Workers runtime: smoke already runs `npm run preview -- --port 4321 &` after writing `.env` and `.dev.vars` (`ci.yml:92-97`). Playwright's `webServer` can replace that (config builds and previews itself), but `ASTRO_PREVIEW_BACKGROUND=1` is set only inside the config, and `.env`/`.dev.vars` must exist before the build. The `playwright.config.ts` loads `.env` only if present (`playwright.config.ts:5-7`), so in CI the E2E_* and MO_INGEST_TOKEN variables must come from job `env`.
- Not yet verified (needs an actual CI or local run): browsers install step (`npx playwright install --with-deps chromium`) time, and `workerd` under Playwright's webServer on the runner. The smoke job already proves preview works on the runner.
- Requiredness: the test plan makes the e2e "required after §3 Phase 4" (`test-plan.md:109`). The `changes` job gates smoke for docs-only PRs (`ci.yml:36-59`); an e2e job should reuse `needs: changes` and the fail-closed `if`.
- Ordering: `npm run test:replay` resets the DB and must stay last (`ci.yml:112-118`). If e2e shares the smoke job, it goes before the replay step and after the keep-alive failure step has been replaced (that step overwrites `.env`/`.dev.vars` with unreachable URLs, `ci.yml:100-107`). A separate job avoids both couplings at the cost of a second Supabase start (about the same as the existing job's).

## Code References

- `playwright.config.ts:20-42` - projects, webServer, CI retries/workers
- `tests/e2e/auth.setup.ts:5-30` - sign-in setup with hydration retry
- `.github/workflows/ci.yml:62-120` - smoke job (Supabase, Mailpit, preview, replay last)
- `src/pages/api/mo/deliveries.ts:56-135` - delivery, provisioning, invite fallback
- `supabase/templates/invite.html`, `supabase/config.toml:154,182` - link host, email limit
- `src/lib/ratings.ts:36-38` - rating window
- `src/components/plan/UpcomingWeekEditor.tsx`, `MealRating.tsx`, `MealSlot.astro` - UI selectors
- `scripts/smoke.mjs:422-558` - generate_link, admin user create, Mailpit read helpers to port

## Architecture Insights

- Two cheaper layers already cover the rules (pgTAP for plan rules, smoke for HTTP/email-link flows); the e2e should assert only what needs a browser: hydration, optimistic UI, cookie session across contexts. This matches the test plan's anti-pattern note (`test-plan.md:61`).
- Smoke's selector approach uses server-rendered HTML; the e2e should use role/label selectors (`getByRole("radio")`, `getByRole("button", { name: <face label> })`), which exist because the components expose `aria-label`/`aria-pressed`/legend text.

## Historical Context (from prior changes)

- `context/changes/testing-critical-journey-e2e/change.md` - notes the fixture-helper phase and the stale manual user; supported by the findings above (the manual user's Monday 2026-10-12 week starts tomorrow, 2026-10-12 vs today 2026-10-11; after it starts, "Next week" has no radios unless another week is delivered, so the seed assertion goes stale).
- `context/foundation/test-stack.md` - E2E section from `/10x-e2e-setup`, consistent with the config.
- `context/archive/2026-10-04-dashboard-pgrst303-retry` - the past dashboard failure that risk #4 cites (not reread this session).

## Related Research

None found under `context/changes/**/research.md` or the archive for browser tests (archive folders listed by name only; contents not searched for e2e topics beyond grepping `docs/` for "playwright", which returned nothing).

## Open Questions

1. Invitation link host in local runs on port 4322: rewrite origin in the test, or set a local `site_url`? (Recommendation: rewrite in the helper; keep `config.toml` unchanged.) Needs a user choice only if they'd rather change config.
2. One job or two? Separate job is cleaner (own `.env`, no keep-alive overwrite, no replay wipe); cost is a second Supabase start. Decision for `/10x-plan`.
3. Should the journey use the real invitation email (needs Mailpit and the 2/hour budget) or generate the link with the admin API? Real email proves the template and link host; admin API is robust locally. Not verified which the user wants for risk #7.
4. Playwright browser install and run time on `ubuntu-latest` unmeasured.
5. The `setup` project's stored user (E2E_USERNAME) versus the journey's per-run user: whether the seed spec stays on the stored user or moves onto the helper.
