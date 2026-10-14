# Sentry Error Monitoring — Plan Brief

> Full plan: `context/changes/add-sentry/plan.md`

## What & Why

Add Sentry so an unhandled error in production (Worker, pages, API routes, the daily keep-alive, the browser) is reported instead of sitting in Worker logs nobody reads. It complements M-2's tests: they stop failures before production, Sentry notices the ones that get through (roadmap S-07, nice-to-have, issue #136).

## Starting Point

No error tracking today. The Worker entry `src/worker.ts` is our own (`{ fetch: handle, scheduled }` for the keep-alive), Astro turns page and route errors into 500s itself, React islands have no error reporting, and CI produces no source maps.

## Desired End State

Production errors from the Worker and the browser show up in Sentry with a readable stack trace, the git SHA as release, and no personal data. A Sentry cron monitor tracks the keep-alive. Local dev, preview, smoke and e2e send nothing.

## Key Decisions Made

| Decision                          | Choice                                                                                            | Why (1 sentence)                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Signals                           | Errors + keep-alive cron monitor; no tracing, replay or logs                                      | The monitor catches a keep-alive that never runs; tracing has little value for 2–4 users.  |
| Server SDK                        | `@sentry/cloudflare` `withSentry` on our existing entry, plus a middleware `captureException`     | One init covers requests and the cron; Astro hides route errors from the Worker otherwise. |
| `@sentry/astro`                   | Browser only (`enabled: { client: true, server: false }`)                                         | Its server SDK uses Node's HTTP transport, which silently loses events on Workers.         |
| Personal data                     | Nothing personal: no IP, cookies, bodies, query strings, user; emails masked                      | MO payloads and sign-in emails must not leave the app; `token_hash` lives in URL queries.  |
| Environments                      | Production only; the DSN exists only in the deploy job                                            | Keeps the free 5k-error quota for real failures; tests need no Sentry secret.              |
| DSN handling                      | One `PUBLIC_SENTRY_DSN` (GitHub variable) → build env + `wrangler deploy --var`                   | Public value, one name for both sides, nothing committed that would switch on local/CI.    |
| Source maps                       | Uploaded in the deploy job, deleted from `dist` before deploy, build fails on upload error        | Readable traces without serving maps publicly.                                             |
| Verification                      | Unit tests for options/scrubbing, bundle-size dry-run in CI, manual preview check, one prod check | Proves the workerd transport without a permanent test route.                               |
| Handled failures, console capture | Out of scope                                                                                      | The user's next change decides which logged failures become events.                        |

## Scope

**In scope:**

- Worker and middleware error capture, keep-alive cron monitor
- Browser error capture (errors only)
- Shared privacy rules with unit tests
- Release tagging, source-map upload, no-map and bundle-size CI checks
- Docs: deployment, README, testing

**Out of scope:**

- Reporting handled failures; `captureConsoleIntegration`
- Tracing, replay, profiling, logs, metrics
- Alert rules (FR-019 stays parked); user ids on events
- Local/CI event sending; a throw-on-demand route
- Error boundaries, Sentry tunnel, custom error pages

## Architecture / Approach

`src/worker.ts` → `withSentry(env => sentryOptions(env), { fetch: handle, scheduled })`; `scheduled` runs inside `withMonitor("supabase-keepalive", …)`. `src/middleware.ts` wraps the request in `try/catch` → `captureException` → rethrow. The browser loads `sentry.client.config.ts` via `@sentry/astro`. Both sides take `dataCollection` and `beforeSend`/`beforeBreadcrumb` from `src/lib/sentry-privacy.ts`. With no `PUBLIC_SENTRY_DSN` both SDKs are off.

## Phases at a Glance

| Phase                                    | What it delivers                                                                                            | Key risk                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. Server error reporting                | `@sentry/cloudflare`, privacy + options modules with tests, wrapped entry, middleware capture, cron monitor | Middleware and entry ending up with two SDK copies, so route errors go nowhere; caught by the manual preview check |
| 2. Browser error reporting               | `@sentry/astro` client-only, `sentry.client.config.ts`                                                      | Default snippet (replay) slipping in; ~25–30 KB more JS                                                            |
| 3. Release, source maps, deploy and docs | Deploy-job secrets/vars, map upload + no-map check, `--var`s, CI bundle-size check, docs                    | Upload failure blocks a deploy; real proof only after merge                                                        |

**Prerequisites:** Sentry project `mo-web` in org `malpiszon` (via the installed Sentry plugin's onboarding or the dashboard); GitHub secret `SENTRY_AUTH_TOKEN` and variables `PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` before merging.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- `withSentry` around Astro's `handle` and the middleware import share one SDK instance in the Vite-built Worker (unverified until the Phase 1 preview check).
- `wrangler deploy --var` works with the adapter-generated Wrangler config.
- Free plan: 1 cron monitor (used here), 5k errors/month; ad blockers drop some browser events.

## Success Criteria (Summary)

- A deliberate browser error on production appears in Sentry with a source-mapped trace, the merge SHA and no personal data.
- The keep-alive's daily check-in appears in Sentry from production.
- CI stays green with no Sentry secret in the test jobs, and no `.map` file is publicly served.
