<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Sentry Error Monitoring

- **Plan**: context/changes/add-sentry/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

All five planned changes match (drift review); the four adaptations (`{ enabled: false }`, type-only `@sentry/core`, `return await next()`, `infer_ip: "never"`) are implemented as reported. Lint, 224 unit tests and `astro check` re-run green; build, dry-run (589 KiB gzip), smoke and e2e green on the same tree; manual checks 1.8–1.12 evidenced via the Sentry API (events MO-WEB-2, monitor `supabase-keepalive` env `verification` OK at 17:25:54Z).

## Findings

### F1 — Breadcrumb data not fully scrubbed (console arguments, fetch url parts)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/sentry-privacy.ts:25-43
- **Detail**: The default Console integration records breadcrumbs with the raw arguments in `data.arguments` next to the formatted `message` (`@sentry/core` `integrations/console.js:30-38`). `scrubBreadcrumb` masks emails only in `message`, so an email in a `console.error` argument (e.g. an MO delivery error message, `deliveries.ts:53`) reaches Sentry unmasked in `data.arguments`. Fetch breadcrumbs also carry `data["url.fragment"]` / `data["url.query"]`, which no setting filters. Tests pass only because fixtures lack these keys.
- **Fix**: In `scrubBreadcrumb`, drop `data.arguments` (the masked `message` already holds the text) and `url.query` / `url.fragment`; add a test with a console-shaped and a fetch-shaped breadcrumb.
- **Decision**: FIXED — `scrubBreadcrumb` drops `data.arguments`, `url.query`, `url.fragment`; tests added

### F2 — Errors thrown while a page body streams are not captured

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:11-39
- **Detail**: Astro streams SSR by default (`App` `streaming = true`, `astro/dist/core/app/base.js:73`). `next()` resolves once the page's own frontmatter has run; an error thrown later by a child component or layout errors the response stream after the middleware's `try` has returned, and `withSentry`'s fetch wrapper only pipes the body without capturing. Today's pages load data in page frontmatter, so exposure is limited to render-time bugs in components, but "every unhandled page error" (Desired End State) does not hold for those.
- **Fix A ⭐ Recommended**: Wrap the response body in the middleware with a `TransformStream`/`pipeThrough` that calls `captureException` when the source stream errors (only for streamed HTML responses), with a unit test of the wrapper.
  - Strength: Closes the gap at the one place every request passes; keeps the plan's end state true.
  - Tradeoff: Touches the response path of every page; must preserve headers/status and not buffer the stream.
  - Confidence: MED — stream wrapping is standard, but Astro/workerd stream behaviour needs a manual throwing-child-component check.
  - Blind spot: Haven't verified how workerd surfaces a mid-stream error to the client (truncated body vs. reset).
- **Fix B**: Document the limit (plan addendum + Phase 3 docs' "what isn't reported") and leave the code.
  - Strength: No risk to the response path; honest about coverage.
  - Tradeoff: A broken component renders a truncated page with nothing in Sentry.
  - Confidence: HIGH — doc-only.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B — limit recorded for Phase 3's docs (#139 comment); no code change

### F3 — Middleware captures are marked "handled"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:36
- **Detail**: `captureException(error)` uses the default mechanism (`handled: true`, `generic`); the worker-level captures use `handled: false`. Route 500s show as handled and don't count in unhandled/crash-free stats (the verified event had mechanism `generic`).
- **Fix**: `captureException(error, { mechanism: { handled: false, type: "auto.middleware.astro" } })`.
- **Decision**: FIXED — middleware captures with `mechanism: { handled: false, type: "auto.middleware.astro" }`

### F4 — Email mask misses URL-encoded addresses

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/sentry-privacy.ts:13
- **Detail**: `EMAIL_PATTERN` doesn't match `anna%40example.com` (an address inside an encoded URL repeated in an error message) or non-ASCII parts. No current code path produces these.
- **Fix**: Accept `(?:@|%40)` as the separator in `EMAIL_PATTERN`, with a test case.
- **Decision**: FIXED — `EMAIL_PATTERN` accepts `%40` (case-insensitive); test added

### F5 — Header allowlist is substring-matched; other header names still sent

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/sentry-privacy.ts:10
- **Detail**: `@sentry/core` matches allow terms by substring (`filterKeyValueData.js`), so `accept` also passes `accept-language` and `accept-encoding` values (seen in the verified event). Other header names are sent with `[Filtered]` values; `contexts.culture.timezone` comes from `request.cf`. Quasi-identifying, not personal data.
- **Fix**: Accept and document it in Phase 3's "Error monitoring" docs section (what is sent).
- **Decision**: FIXED — recorded for Phase 3's docs (#139 comment)

### F6 — Comment in sentryOptions misstates why `enabled: false`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/sentry.ts:13
- **Detail**: The comment says `undefined` would fall back to `env.SENTRY_DSN`; `getFinalOptions` fills `dsn` from `env.SENTRY_DSN` either way. What keeps the SDK silent is `enabled: false` (`Client._isEnabled()`), which also skips integration setup.
- **Fix**: Reword to "`enabled: false` keeps the SDK silent even if a `SENTRY_DSN` var appears, which the SDK reads by itself."
- **Decision**: FIXED — comment reworded

### F7 — Monitor schedule follows whatever cron a manual trigger passes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker.ts:39
- **Detail**: `controller.cron` is sent as the monitor's crontab on every in-progress check-in; a manual trigger with another or empty cron (e.g. `--test-scheduled`) with the DSN set would rewrite the monitor's schedule. Production only runs the configured trigger, and no other environment has a DSN.
- **Fix**: Accept; no change (the plan chose `controller.cron` deliberately so the monitor follows `wrangler.jsonc`).
- **Decision**: ACCEPTED — deliberate plan choice; only production has a DSN
