# Critical-journey e2e as a CI gate (S-04) — Plan Brief

> Full plan: `context/changes/testing-critical-journey-e2e/plan.md`
> Research: `context/changes/testing-critical-journey-e2e/research.md`

## What & Why

Test-plan risk #4: the critical journey can break in a real browser while the HTTP smoke stays green (a dashboard error, a swap, save or rating that doesn't work). This change adds one Playwright journey on the Workers preview (delivery → invitation → set password → dashboard → keep picks → swap → rate → sign out → sign in again → choices still there). It runs as a required CI gate before deploy, and also covers the invitation half of risk #7.

## Starting Point

Playwright is already set up on this branch (config, sign-in `setup` project, a read-only seed spec), but nothing is committed and CI doesn't run it. The seed depends on a user created by hand whose only upcoming week starts on 2026-10-12, so it goes stale, and CI has no such user at all.

## Desired End State

`npx playwright test` passes on any date, on an empty or a reused local stack, and again right after. Every code PR runs a CI job `e2e` with its own Supabase and Mailpit; it is a required check and `deploy` waits for it. A failure uploads the report with a trace. The docs and test plan describe the e2e as it is.

## Key Decisions Made

| Decision          | Choice                                                                            | Why (1 sentence)                                                                                                   | Source          |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| Fixture helper    | Deliver weeks relative to today in Warsaw; provision the setup user via admin API | Removes the stale hand-made user and works in CI on an empty stack.                                                | Change note     |
| Invitation        | Real email read from Mailpit, no admin fallback                                   | Proves the template and link end to end; no email is a failure.                                                    | Plan            |
| Email budget      | Not a constraint                                                                  | `email_sent = 2` needs custom SMTP; the local and CI auth container runs with 360000/hour (corrects the research). | Plan (verified) |
| Link host         | Rewrite the invitation link's origin to `baseURL`                                 | Local preview runs on :4322 while `site_url` is :4321; no config change.                                           | Research        |
| Two deliveries    | This week (rate) and next week (keep picks, swap) for the same new user           | Swap/save need an upcoming week, rating needs a started one.                                                       | Research        |
| Isolation per run | A unique journey email per run, no stack reset                                    | Re-runs never collide and nothing needs wiping.                                                                    | Research        |
| CI placement      | Separate `e2e` job, gated like smoke, `deploy` needs it, required check           | Its own `.env` and stack, with no keep-alive overwrite or replay wipe; runs in parallel with smoke.                | Plan            |
| Retries           | 1 retry in CI, trace `retain-on-failure`, report uploaded on failure              | Absorbs one infrastructure blip and keeps a trace for every failure.                                               | Plan            |
| Seed and setup    | Keep both; `setup` provisions its own user                                        | A ready signed-in user for future specs (§6.4).                                                                    | Plan            |

## Scope

**In scope:**

- `tests/e2e/support/` helpers (deliveries, users, Mailpit)
- A self-provisioning `auth.setup.ts`
- `critical-journey.spec.ts`
- Playwright config for CI
- The `e2e` job and `deploy` gating
- The required check on `master`
- `npm run test:e2e`
- Updates to `docs/testing.md`, test-plan §3/§4/§5/§6.4/§6.5, `test-stack.md` and the README

**Out of scope:**

- App, migration or `config.toml` changes
- Re-checking pgTAP/smoke rules in the browser
- An admin-API invitation fallback
- Other browsers, visual tests, browser caching in CI
- Changes to the smoke job

## Architecture / Approach

Small helpers port smoke's admin and Mailpit calls to TypeScript and build deliveries by shifting `scripts/fixtures/mo-delivery.sample.json` to Mondays computed with the app's own `todayInWarsaw`. The `setup` project uses them to make sure its user has an upcoming week and a password. The journey uses them for a new user per run, in a context without the stored session. In CI, Playwright's `webServer` builds and previews on 4321 after the job writes `.env`/`.dev.vars` from a fresh local Supabase.

## Phases at a Glance

| Phase                                         | What it delivers                                                     | Key risk                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Fixture helper and self-provisioning setup | Seed green on any date and on an empty stack; setup committed        | Admin API lookup/update shapes differ across GoTrue versions                 |
| 2. Critical-journey spec                      | One journey, new user per run, green locally twice in a row          | Hydration races on set-password and sign-in; picking a swappable slot        |
| 3. CI gate and docs                           | `e2e` job green, required, before deploy; docs and test plan current | workerd under Playwright's webServer on the runner; added CI time unmeasured |

**Prerequisites:** local Supabase running with Mailpit; `.env` with the app secrets plus `E2E_PORT=4322`, `E2E_USERNAME`, `E2E_PASSWORD`; repo admin access for branch protection.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes the invitation email reaches Mailpit within ~15 s in CI. The smoke's reset email suggests it does.
- First CI run time is unmeasured; it's recorded in test-plan §6.5 afterwards.
- Changing branch protection is outward-facing, so it's confirmed with the user at implementation time.

## Success Criteria (Summary)

- A PR that breaks the dashboard, a swap, saving, rating or the session in the browser fails the required `e2e` check before it can merge or deploy.
- The e2e runs locally on any day without hand-made users or a reset.
