# Sentry Error Monitoring Implementation Plan

## Overview

Report production errors from mo-web to Sentry so a failure that slips past the tests is noticed instead of going silent (roadmap S-07, issue #136). The Worker (requests and the daily keep-alive) reports through `@sentry/cloudflare`, the browser through `@sentry/astro` with its server side turned off, the keep-alive checks in with a Sentry cron monitor, and nothing personal leaves the app. Only the production deploy sends events.

## Current State Analysis

- No error tracking. Errors are logged with `console.error`/`console.warn` (code and message only) and reach Workers observability logs (`wrangler.jsonc` `observability.enabled`), which nobody watches.
- The Worker entry is our own: `src/worker.ts:37` exports `{ fetch: handle, scheduled }`, `handle` from `@astrojs/cloudflare/handler`. The cron (`0 3 * * *`) pings Supabase, logs and rethrows on failure (`src/worker.ts:22-34`).
- Astro catches errors thrown in pages and routes and answers 500 itself, so they never reach the Worker's `fetch` as exceptions. `src/middleware.ts` is the one place every request passes through (`next()` at `:12` for MO routes, `:33` for the rest; `getUser()` at `:20` can throw too).
- React islands catch their own fetch failures (`usePlanChoices.ts:29-47`, `useMealRating.ts:12-28`); there are no error boundaries. An uncaught render error reaches the browser's global error handler.
- Personal data in requests: MO delivery bodies (user email, meals; `src/lib/mo-delivery.ts:38-92`), sign-in and forgot-password forms (email, password), `token_hash` in the query of `/api/auth/confirm` and `/auth/set-password`, the MO bearer header, Supabase auth cookies on every request.
- No source maps are produced; the deploy job runs `npm run build` then `npx wrangler deploy` (`.github/workflows/ci.yml:181-183`) and passes no git SHA.

## Desired End State

- An unhandled error in a page, API route, middleware or the keep-alive on the production Worker becomes a Sentry event tagged `environment=production` and `release=<git sha>`, with a readable (source-mapped) stack trace, the route URL without query string, and no cookies, bodies, IP, user or email.
- An uncaught error in the browser on a production page becomes a Sentry event under the same rules.
- The keep-alive checks in with the Sentry cron monitor `supabase-keepalive` each run; a failed or missing run marks the monitor failed.
- Local dev, `npm run preview`, smoke and e2e (locally and in CI) send nothing: no DSN exists there.
- No `.map` file is served from the production Worker's assets.

Verify: the unit tests and CI gates below, a local preview with a temporary DSN (Phases 1–2), and, after merge, a browser test error plus the keep-alive check-in visible in Sentry (Phase 3).

### Key Discoveries:

- `@sentry/astro` 11.6.0 accepts `enabled: { client: true, server: false }`; with `server: false` it injects no server init and no `@sentry/astro/middleware`, but still configures source-map upload for all of `dist` and deletes the maps after upload (`@sentry/astro/build/esm/integration/index.js:44-108, 129-166`). With the Cloudflare adapter it exits the build if `@sentry/cloudflare` isn't installed (`:116-127`).
- Its server SDK must stay off on Workers: it sends through Node's HTTP transport, which loses events on workerd silently (user's reference material).
- `@sentry/cloudflare` 11.6.0 `withSentry(optionsCallback: (env) => options | undefined, handler)` instruments every handler on the object, including `scheduled` (isolation scope, `captureException` on throw, flush via `waitUntil`), and sets up the async context itself. `withMonitor` and `captureException` are exported from the same package.
- Sentry v11 deprecates `sendDefaultPii`; the `dataCollection` option (`@sentry/core` `types/datacollection.d.ts:27`) collects IP, cookies, headers, all HTTP bodies and query values by default. Its denylist would filter tokens and the auth cookie, but not emails or meal data.
- Free Developer plan: 5k errors/month, 1 cron monitor.
- The integration's default client snippet enables session replay; a `sentry.client.config.ts` at the project root replaces it.

## What We're NOT Doing

- Reporting failures the app handles and answers with a success or a friendly message (invite email fallback `deliveries.ts:125`, recency re-read `plan-save.ts:53`, fail-open `services/auth-links.ts:19`, island fetch failures). That is the user's next change.
- Forwarding `console.error`/`console.warn` as events (`captureConsoleIntegration`); belongs to that next change.
- Tracing, session replay, profiling, Sentry logs or metrics.
- Alert rules for failed deliveries or keep-alive runs (FR-019 stays parked); only the monitor's built-in failure state.
- Tagging events with a user id or email.
- Sending events from local dev, preview, smoke or e2e; no opt-in local environment.
- A permanent test route that throws on demand.
- React error boundaries / fallback UI for the islands.
- A Sentry tunnel to get past ad blockers; custom 404/500 pages.
- Using `@sentry/astro`'s server side, its default entry wrapping, or a DSN committed in `wrangler.jsonc` (reference material suggestions checked and declined above).

## Implementation Approach

One Sentry project for browser and server, one public DSN under one name, `PUBLIC_SENTRY_DSN`. The deploy job is the only place it exists: as a build-time env var (inlined into the browser bundle) and as `wrangler deploy --var` (read by the Worker at runtime). Everywhere else it is absent, which turns both SDKs off.

Server: `withSentry` wraps our existing entry object, so one init covers requests and the keep-alive. A middleware `try/catch` around the request reports what Astro would otherwise turn into a 500. Browser: `@sentry/astro` client-only, errors only. A shared, browser-safe privacy module holds the `dataCollection` settings and the `beforeSend`/`beforeBreadcrumb` scrubbers both sides use; it is the unit-tested core.

## Critical Implementation Details

- **One Sentry instance in the Worker bundle.** The middleware's `captureException` only works if it reaches the client that `withSentry` initialised in `src/worker.ts`. If the build ends up with two copies of `@sentry/cloudflare` (or `@sentry/core`), middleware captures go nowhere without an error. Phase 1's manual check (an event from a throwing page) is what proves this; don't skip it.
- **Query strings carry tokens.** `token_hash` sits in URL queries, and `Referer` can repeat a URL with its query, so the `Referer` header is not on the header allowlist, and the scrubber strips query and fragment from every URL it sees (event request, breadcrumbs), on top of `urlQueryParams: false`.
- **Monitor schedule follows the trigger.** Pass `controller.cron` as the monitor's crontab rather than repeating `0 3 * * *`, so changing `wrangler.jsonc` can't leave the monitor expecting the old schedule.

## Phase 1: Server error reporting

### Overview

Install `@sentry/cloudflare`, add the shared options and privacy code with unit tests, wrap the Worker entry, capture route errors in middleware, and add the keep-alive cron monitor. Without `PUBLIC_SENTRY_DSN` everything stays inert, so smoke and e2e keep passing unchanged.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `@sentry/cloudflare` as a runtime dependency.

**Contract**: Exact version `11.6.0` (no caret). `@sentry/astro` in Phase 2 must use the same exact version, so both share one `@sentry/core`.

#### 2. Privacy module (browser-safe)

**File**: `src/lib/sentry-privacy.ts` (new), `src/lib/sentry-privacy.test.ts` (new)

**Intent**: One place that decides what may leave the app, used by both the Worker and the browser config. No import from `@sentry/cloudflare` or anything Worker-only, so the browser bundle can use it.

**Contract**:

- `SENTRY_DATA_COLLECTION`: `userInfo: false`, `cookies: false`, `httpBodies: []`, `urlQueryParams: false`, request headers limited to an allowlist (`user-agent`, `content-type`, `accept`; never `referer`, `authorization`, `cookie`), response headers off.
- `scrubEvent(event)` (for `beforeSend`): removes `event.user`; strips query string and fragment from `event.request.url`; drops `event.request.query_string`, `cookies`, `data`; replaces email-like substrings with `[email]` in the message, exception values and breadcrumb messages; strips query/fragment from breadcrumb URLs.
- `scrubBreadcrumb(breadcrumb)` (for `beforeBreadcrumb`): same URL and email rules for a single breadcrumb (`data.url`, `data.from`, `data.to`, `message`).
- Tests: a confirm URL with `token_hash` loses its query; an MO-style error message containing an email is masked; `user`, cookies and body are dropped; an event without those fields passes through unchanged.

#### 3. Worker options

**File**: `src/lib/sentry.ts` (new), `src/lib/sentry.test.ts` (new)

**Intent**: Build the `@sentry/cloudflare` options from the Worker env, so the entry stays a one-liner and the rules are testable.

**Contract**: `sentryOptions(env: { PUBLIC_SENTRY_DSN?: string; SENTRY_ENVIRONMENT?: string; SENTRY_RELEASE?: string })` returns options that send nothing when the DSN is missing or empty (verify which of `undefined` or `enabled: false` `withSentry` handles without warnings), otherwise: `dsn`, `environment` (`SENTRY_ENVIRONMENT` or `"production"`), `release` (`SENTRY_RELEASE` when set), no `tracesSampleRate` (tracing off), `dataCollection: SENTRY_DATA_COLLECTION`, `beforeSend: scrubEvent`, `beforeBreadcrumb: scrubBreadcrumb`. Tests cover the no-DSN, defaults and override cases.

#### 4. Worker entry and keep-alive monitor

**File**: `src/worker.ts`

**Intent**: Wrap the existing handler object in `withSentry` so requests and the keep-alive run inside Sentry, and make the keep-alive check in with a cron monitor.

**Contract**: `export default Sentry.withSentry((env) => sentryOptions(env), { fetch: handle, scheduled })`; the env interface gains the three optional Sentry fields. Inside `scheduled`, the ping runs within `Sentry.withMonitor("supabase-keepalive", fn, { schedule: { type: "crontab", value: controller.cron }, timezone: "UTC", checkinMargin, maxRuntime })` with small margins (minutes). The existing log lines and the rethrow stay; `withMonitor` reports the failed check-in and `withSentry` captures the rethrown error.

#### 5. Route error capture

**File**: `src/middleware.ts`

**Intent**: Report errors that Astro would otherwise turn into a 500 without the Worker seeing them.

**Contract**: The whole `onRequest` body (both `next()` calls and the `getUser()` lookup) runs inside a `try/catch` that calls `Sentry.captureException(error)` from `@sentry/cloudflare` and rethrows, so Astro's 500 behaviour is unchanged. No other middleware behaviour changes (MO routes still skip the session; protected-route redirects stay).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass, including the new privacy and options tests: `npm test`
- Types check: `npx astro check`
- Build succeeds: `npm run build`
- Worker bundle stays under the free-plan limit: `npx wrangler deploy --dry-run --outdir <tmp>` reports gzip size < 3 MB; before/after sizes noted on the phase sub-issue
- Smoke passes against a preview on :4322 with no DSN: `npm run smoke`
- E2E passes with no DSN: `npm run test:e2e`

#### Manual Verification:

- Sentry project `mo-web` exists in org `malpiszon` (created through the Sentry plugin's onboarding flow or the dashboard) and its DSN is at hand
- Local `npm run preview` with the DSN and `SENTRY_ENVIRONMENT=verification` in `.dev.vars` (temporary, never committed) and a throwaway page that throws: one event appears in Sentry with the route URL, stack trace, `environment=verification`, and no query string, cookies, body, IP or user
- A request to `/api/auth/confirm?token_hash=…` on the same preview that errors (or a throwaway variant of the page) shows no `token_hash` anywhere in the event
- Triggering the scheduled handler locally (wrangler's scheduled test endpoint) records an OK check-in for `supabase-keepalive`
- Throwaway page and temporary `.dev.vars` entries removed; `git status` shows neither

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Browser error reporting

### Overview

Add `@sentry/astro` for the browser only, with errors only and the shared privacy rules. It turns on only when `PUBLIC_SENTRY_DSN` is set at build time.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `@sentry/astro` as a runtime dependency.

**Contract**: Exact version `11.6.0`, matching `@sentry/cloudflare`.

#### 2. Integration

**File**: `astro.config.mjs`

**Intent**: Register the Sentry integration with its server side off; the server is handled by `@sentry/cloudflare` (Phase 1).

**Contract**: `sentry({ enabled: { client: true, server: false }, sourcemaps: { disable: true } })` added to `integrations`, with a one-line comment why the server side is off (Node HTTP transport loses events on Workers). Source maps stay disabled until Phase 3 wires the upload.

#### 3. Client init

**File**: `sentry.client.config.ts` (new, project root; picked up by the integration automatically)

**Intent**: Initialise the browser SDK for errors only, sharing the server's privacy rules.

**Contract**: `Sentry.init` from `@sentry/astro` with `dsn: import.meta.env.PUBLIC_SENTRY_DSN`, `enabled` only when that DSN is non-empty, `environment: "production"`, default integrations only (no replay, no browser tracing, no `tracesSampleRate`), `dataCollection: SENTRY_DATA_COLLECTION`, `beforeSend: scrubEvent`, `beforeBreadcrumb: scrubBreadcrumb` (imported from `src/lib/sentry-privacy.ts`). The file is TypeScript, so it is linted and type-checked like the rest.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Types check: `npx astro check`
- Build succeeds without a DSN, and no ingest host appears in the client output: `npm run build` then no match for `ingest` in `dist/client/**/*.js` besides the SDK's own code paths (check the DSN host specifically when one is set)
- E2E passes with no DSN: `npm run test:e2e`
- Smoke passes against a preview on :4322: `npm run smoke`

#### Manual Verification:

- Client JS size before/after noted on the phase sub-issue (expected roughly +25–30 KB gzip on pages with islands)
- Local build and preview with `PUBLIC_SENTRY_DSN` set at build time (temporary, not committed): `setTimeout(() => { throw new Error("sentry browser test") })` in devtools produces one event with the page URL without query, no user or IP
- On a preview built without the DSN, the browser's network tab shows no request to Sentry during sign-in and the dashboard

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Release, source maps, deploy and docs

### Overview

Make the deploy job the only place the DSN exists, tag events with the git SHA, upload source maps and keep them off the public assets, add the bundle-size check to PR CI, and document the setup.

### Changes Required:

#### 1. Source maps and release in the integration

**File**: `astro.config.mjs`

**Intent**: Upload source maps (Worker and browser) only when an auth token is present, fail the build loudly if the upload fails, and name the release after the git SHA.

**Contract**: `sentry({ …, org: SENTRY_ORG, project: SENTRY_PROJECT, authToken: SENTRY_AUTH_TOKEN, release: { name: SENTRY_RELEASE }, sourcemaps: { disable: !SENTRY_AUTH_TOKEN }, errorHandler: (err) => { throw err } })`, values read from `process.env`. Without a token (local, `ci` job, smoke, e2e) no maps are generated or uploaded. With a token the integration's default `filesToDeleteAfterUpload` removes `dist/**/client/**/*.map` and `dist/**/server/**/*.map`.

#### 2. Deploy job

**File**: `.github/workflows/ci.yml` (`deploy` job)

**Intent**: Give the build what it needs to upload maps and inline the DSN, prove no map ships, and pass DSN and release to the Worker.

**Contract**:

- `npm run build` env: `SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}`, `SENTRY_ORG: ${{ vars.SENTRY_ORG }}`, `SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT }}`, `PUBLIC_SENTRY_DSN: ${{ vars.PUBLIC_SENTRY_DSN }}`, `SENTRY_RELEASE: ${{ github.sha }}`.
- New step after the build: fail if any `*.map` file exists under `dist/`.
- `npx wrangler deploy --var PUBLIC_SENTRY_DSN:${{ vars.PUBLIC_SENTRY_DSN }} --var SENTRY_RELEASE:${{ github.sha }}` (vars passed on every deploy, so nothing is kept in `wrangler.jsonc`).

#### 3. Bundle-size check on PRs

**File**: `.github/workflows/ci.yml` (`ci` job)

**Intent**: Catch a Worker bundle over the free-plan limit (or a bundling error from the Sentry packages) before merge rather than at deploy.

**Contract**: After `npm run build`, run `npx wrangler deploy --dry-run --outdir <tmp>` (no Cloudflare credentials needed) and fail when the reported gzip size is ≥ 3 MB.

#### 4. Docs

**Files**: `docs/deployment.md`, `README.md`, `docs/testing.md`

**Intent**: Describe the current setup so a reader can configure, verify and reason about it.

**Contract**:

- `docs/deployment.md`: GitHub secrets table gains `SENTRY_AUTH_TOKEN` (organization token, release/source-map scope); a GitHub **variables** table lists `PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`; the deploy description mentions the source-map upload and `--var`s. New section "Error monitoring (Sentry)": what is reported (unhandled Worker, middleware and browser errors; keep-alive monitor) and what isn't (handled failures, console logs), the privacy rules, the Sentry project settings to set by hand ("Prevent Storing of IP Addresses", server-side data scrubbing on), free-plan limits, and the post-deploy check. "Known risks" gains: ad blockers drop some browser events; events from a build without the DSN never arrive by design.
- `README.md`: tech stack lists Sentry; the env section says the Sentry values are deploy-only and not needed locally.
- `docs/testing.md#ci`: the `ci` job's bundle-size dry-run and the deploy job's no-source-map check.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Types check: `npx astro check`
- Build without `SENTRY_AUTH_TOKEN` produces no `.map` files: `npm run build && ! find dist -name '*.map' | grep -q .`
- Bundle-size dry-run passes locally: `npx wrangler deploy --dry-run --outdir <tmp>`
- Prettier check on changed docs passes: `npx prettier --check docs/deployment.md docs/testing.md README.md`
- PR CI (`ci`, `smoke`, `e2e`) is green

#### Manual Verification:

- GitHub secret `SENTRY_AUTH_TOKEN` and variables `PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` set before merging; Sentry project settings "Prevent Storing of IP Addresses" and data scrubbing on
- After merge, the `deploy` job is green, including the upload and the no-map check
- Sentry shows a release named after the merge commit's SHA with uploaded artifacts
- On production, `setTimeout(() => { throw new Error("sentry browser test") })` in devtools gives an event with a source-mapped stack trace, `environment=production`, the merge SHA as release, no query, user or IP
- `https://mo-web.malpiszon.workers.dev/_astro/<any>.js.map` answers 404
- After the next 03:00 UTC run, the `supabase-keepalive` monitor shows an OK check-in from production (proves the Worker transport on workerd in production)

**Implementation Note**: The first three manual items need the merge; record them on the phase sub-issue and close it once they're ticked.

---

## Testing Strategy

### Unit Tests:

- `src/lib/sentry-privacy.test.ts`: query and fragment stripping (`token_hash`), email masking in messages, exceptions and breadcrumbs, removal of user, cookies and body, untouched pass-through of clean events.
- `src/lib/sentry.test.ts`: no DSN → inert; defaults (`environment: "production"`, no tracing, privacy hooks wired); `SENTRY_ENVIRONMENT`/`SENTRY_RELEASE` overrides.

### Integration Tests:

- Existing smoke and e2e run with no DSN and must pass unchanged; they prove the Sentry wrappers don't alter behaviour when inert.
- The bundle-size dry-run in the `ci` job proves the Sentry packages bundle for workerd.

### Manual Testing Steps:

1. Phase 1: local preview with a temporary DSN: a throwing page and a token-bearing URL produce one scrubbed event each; the scheduled handler records a check-in.
2. Phase 2: local preview built with a temporary DSN: a browser test error produces one scrubbed event; without the DSN no request goes to Sentry.
3. Phase 3, after merge: release with artifacts, a source-mapped browser test error from production, no public `.map`, and the keep-alive check-in.

## Performance Considerations

- Worker bundle grows by the Sentry SDK; the dry-run check holds it under the free-plan limit of 3 MB gzip (currently about 0.5 MB).
- Browser: about 25–30 KB gzip more on pages that load the client SDK; no replay or tracing.
- Events are flushed via `waitUntil` after the response, so request latency is unaffected.

## Migration Notes

No database changes. Rollout order: create the Sentry project (Phase 1), set the GitHub secret and variables and the Sentry project's privacy settings before merging (Phase 3), merge to deploy. Rollback: revert the PR; with the vars removed from `wrangler deploy`, the Worker stops sending.

## References

- Issue: [#136](https://github.com/malpiszon/meal-orchestrator-web/issues/136) — `[S-07] Error monitoring with Sentry`
- Phase sub-issues: Phase 1 [#137](https://github.com/malpiszon/meal-orchestrator-web/issues/137), Phase 2 [#138](https://github.com/malpiszon/meal-orchestrator-web/issues/138), Phase 3 [#139](https://github.com/malpiszon/meal-orchestrator-web/issues/139)
- Roadmap: `context/foundation/roadmap.md` § S-07
- Official guide: https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/astro/
- Options (`dataCollection`): https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/
- Worker entry: `src/worker.ts:17-37`; middleware: `src/middleware.ts:9-34`; deploy job: `.github/workflows/ci.yml:165-202`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server error reporting

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 92185d6
- [x] 1.2 Unit tests pass, including the new privacy and options tests: `npm test` — 92185d6
- [x] 1.3 Types check: `npx astro check` — 92185d6
- [x] 1.4 Build succeeds: `npm run build` — 92185d6
- [x] 1.5 Worker bundle stays under the free-plan limit (dry-run gzip < 3 MB; sizes noted on the sub-issue) — 92185d6
- [x] 1.6 Smoke passes against a preview on :4322 with no DSN: `npm run smoke` — 92185d6
- [x] 1.7 E2E passes with no DSN: `npm run test:e2e` — 92185d6

#### Manual

- [x] 1.8 Sentry project `mo-web` exists in org `malpiszon` and its DSN is at hand — 92185d6
- [x] 1.9 Local preview with a temporary DSN: a throwing page produces one scrubbed event — 92185d6
- [x] 1.10 A token-bearing URL shows no `token_hash` anywhere in the event — 92185d6
- [x] 1.11 Locally triggered scheduled handler records an OK check-in for `supabase-keepalive` — 92185d6
- [x] 1.12 Throwaway page and temporary `.dev.vars` entries removed — 92185d6

### Phase 2: Browser error reporting

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 2b15301
- [x] 2.2 Unit tests pass: `npm test` — 2b15301
- [x] 2.3 Types check: `npx astro check` — 2b15301
- [x] 2.4 Build succeeds without a DSN and no DSN host appears in the client output — 2b15301
- [x] 2.5 E2E passes with no DSN: `npm run test:e2e` — 2b15301
- [x] 2.6 Smoke passes against a preview on :4322: `npm run smoke` — 2b15301

#### Manual

- [x] 2.7 Client JS size before/after noted on the sub-issue — 2b15301
- [x] 2.8 Preview built with a temporary DSN: a browser test error produces one scrubbed event — 2b15301
- [x] 2.9 Preview built without the DSN sends no request to Sentry — 2b15301

### Phase 3: Release, source maps, deploy and docs

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 32b3d36
- [x] 3.2 Unit tests pass: `npm test` — 32b3d36
- [x] 3.3 Types check: `npx astro check` — 32b3d36
- [x] 3.4 Build without `SENTRY_AUTH_TOKEN` produces no `.map` files — 32b3d36
- [x] 3.5 Bundle-size dry-run passes locally — 32b3d36
- [x] 3.6 Prettier check on changed docs passes — 32b3d36
- [ ] 3.7 PR CI (`ci`, `smoke`, `e2e`) is green

#### Manual

- [x] 3.8 GitHub secret and variables set; Sentry IP-storage and scrubbing settings on
- [ ] 3.9 After merge, the `deploy` job is green
- [ ] 3.10 Sentry shows a release named after the merge SHA with artifacts
- [ ] 3.11 Production browser test error has a source-mapped trace and no personal data
- [ ] 3.12 A production `.js.map` URL answers 404
- [ ] 3.13 The `supabase-keepalive` monitor shows an OK check-in from production
