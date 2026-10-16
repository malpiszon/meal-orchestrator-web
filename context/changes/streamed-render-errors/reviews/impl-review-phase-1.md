<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Streamed Render Errors Implementation Plan

- **Plan**: context/changes/streamed-render-errors/plan.md
- **Scope**: Phase 1 of 2
- **Reviewed phases**: 1
- **Date**: 2026-10-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Plan adherence: all three planned items MATCH (99cc47b). Known deviations preserve intent: the tag is set via `withScope` because Sentry's hint takes a mechanism or tags, not both; `eslint.config.js` allowlists the planned `console.error`; one extra string-rejection test. Success criteria re-run: helper tests 8/8, `npm test` 369/369, `npm run lint` 0 errors (2 pre-existing warnings in `report-handled-error.ts`), `astro check` 0 errors. Manual 1.4 confirmed by the user before the commit.

## Findings

### F1 — Stream-error event may be dropped in production

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-stream-errors.ts:25-28
- **Detail**: `@sentry/cloudflare` classifies `text/html` as non-streaming, so it ends the span and flushes (`waitUntil(flushAndDispose(client))`) as soon as the handler returns the Response, before the body is read (`node_modules/@sentry/cloudflare/build/esm/prod/wrapRequestHandlerWithInit.js:91-126`, `@sentry/core/.../responseStreaming.js`). A capture after that point is delivered only by `_setupEagerEnvelopeDelivery`, which registers the send with the request's `waitUntil` only if `getIsolationScope()` in the current async context still carries the invocation state (`prod/client.js:155-213`, `prod/utils/invocationContext.js`). Later `pull` calls are driven by workerd pumping the body; whether AsyncLocalStorage context survives into them is unverified. If not, the send is fire-and-forget and can be cut off, and the event loses the request's scope data. Unit tests can't see this (the `withScope` mock is synchronous), and Phase 2 as planned observes only the log line, not the event.
- **Fix A ⭐ Recommended**: Pin the request's isolation scope at wrap time (`const isolationScope = getIsolationScope()` in `captureStreamErrors`) and report inside `withIsolationScope(isolationScope, () => withScope(...))`; amend Phase 2 so P10 runs a preview build with a fake DSN pointing at a local listener and confirms the event arrives with `step=render.stream`.
  - Strength: `getInvocationState()` reads the invocation state from exactly that scope, so the eager send is registered with the request's `waitUntil` whatever the pull's context; the event keeps request data. Phase 2 then proves the actual goal, not a proxy.
  - Tradeoff: A few lines in the helper plus a test asserting the pinned scope; Phase 2 grows by a fake-endpoint setup.
  - Confidence: MED — mechanism read from the SDK source; runtime behaviour in workerd not yet observed.
  - Blind spot: Whether `waitUntil` registered after the response body has errored still extends the invocation in workerd.
- **Fix B**: Leave the code; amend Phase 2 to run the fake-DSN check first and fix only if the event is lost.
  - Strength: No speculative code; change only on evidence.
  - Tradeoff: Likely a second fix round mid-Phase 2; a pass locally may not reflect production timing.
  - Confidence: MED — the check is decisive for local runtime only.
  - Blind spot: Local workerd and production may differ in context propagation.
- **Decision**: FIXED (Fix A) — helper pins `getIsolationScope()` at wrap time and reports inside `withIsolationScope`, with a test; plan Phase 2 P10 now checks the event with a placeholder DSN pointed at a local listener (new Progress row 2.8).

### F2 — Every body re-streamed, including JSON and MO routes

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:19
- **Detail**: Wrapping fixed bodies (JSON API, MO delivery responses) passes every chunk through a JS `pull` and drops the implicit Content-Length, so they go out chunked. Endpoints in `src` never return streams, so render-stream errors can only come from pages. Wrapping every body was a deliberate plan decision ("no content-type guessing").
- **Fix**: Skip the wrapper on the `MACHINE_ROUTE_PREFIX` branch (MO responses are small JSON with nothing to render); otherwise keep as planned.
- **Decision**: FIXED — the MO branch returns `await next()` unwrapped, with a comment; the main path stays wrapped. Deviates from the Phase 1 contract ("both `next()` returns").

### F3 — Latent double report on rewrite

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:41
- **Detail**: If a page ever uses `Astro.rewrite`/`context.rewrite`, the middleware runs again for the target (`node_modules/astro/dist/core/rewrites/handler.js:71`), the body is wrapped twice and one error is logged twice (Sentry's dedupe likely drops the second event). Not reachable today: no rewrites in `src`.
- **Fix**: Add a one-line comment at the wrap site noting the double wrap under rewrites.
- **Decision**: FIXED — comment at the main wrap site in `src/middleware.ts`.

### F4 — `messageOf` duplicated from report-handled-error

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/report-stream-errors.ts:7-11
- **Detail**: Identical to `src/lib/report-handled-error.ts:46-50`.
- **Fix**: Export `messageOf` from `report-handled-error.ts` and import it.
- **Decision**: FIXED — `messageOf` exported from `report-handled-error.ts`, the copy removed.
