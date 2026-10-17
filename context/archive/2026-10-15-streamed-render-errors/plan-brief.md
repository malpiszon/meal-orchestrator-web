# Streamed Render Errors — Plan Brief

> Full plan: `context/changes/streamed-render-errors/plan.md`

## What & Why

An error thrown by a component after a page starts streaming leaves the user a truncated page with status 200, and no Sentry event or Worker log (audit X2, probe P10). We wrap each response body in the middleware so such errors are logged and reported. Roadmap S-11, issue #146.

## Starting Point

`src/middleware.ts` captures errors thrown before streaming (frontmatter, endpoints) but its `try/catch` ends when `next()` returns. Astro reports body errors only through `controller.error`, with no log, and the Cloudflare adapter gives no way to turn streaming off. `docs/deployment.md` overstates what is reported.

## Desired End State

A render error mid-stream writes one `render.stream failed:` log line and sends one unhandled Sentry event tagged `step: render.stream`. The user still sees the same truncated page as today. Docs state exactly this.

## Key Decisions Made

| Decision            | Choice                                                                         | Why                                                             |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Mechanism           | Wrap the response body in the middleware                                       | Streaming can't be disabled through the adapter                 |
| Reporting           | `captureException`, unhandled, type `auto.middleware.astro.stream`, plus a log | Matches the middleware's existing catch; stack grouping per bug |
| Not the S-08 helper | `reportHandledError` not used                                                  | Render errors have no code, so all would merge into `unknown`   |
| Wrap scope          | Every response with a body                                                     | No content-type guessing; covers any streamed route             |
| User view           | Unchanged truncation, error re-raised                                          | Scope is observability only                                     |
| Proof               | Unit tests plus a one-off P10 run with an uncommitted throwing component       | No test-only route in production code                           |

## Scope

**In scope:** body wrapper helper, middleware wiring, unit tests, P10 before/after record, `docs/deployment.md`.

**Out of scope:** visible error notice, adapter or Astro streaming config, permanent CI probe, alert rules.

## Architecture / Approach

`captureStreamErrors(response)` returns the response unchanged when its body is null, else a new `Response` with the same status and headers over a stream that forwards the source's chunks. A failing read is logged and captured, then the new stream errors with the same error; `cancel` is forwarded. The middleware applies it to what `next()` returns.

## Phases at a Glance

| Phase                              | What it delivers                                               | Key risk                                                                                |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Capture stream errors           | Helper, middleware wiring, unit tests                          | Wrapper must preserve status, headers (`Set-Cookie`) and cancel                         |
| 2. Prove with P10 and fix the docs | Before/after probe record, corrected docs, smoke and e2e green | The DSN is deploy-only, so the event itself is proven by the unit test and the log line |

**Prerequisites:** none (S-07 done). Previews on port 4323.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Wrapping the body may drop Astro-internal state on the `Response`; smoke and e2e (cookies, hydration) are the check.
- The actual Sentry event can't be observed locally; the unit test asserts the `captureException` call.

## Success Criteria (Summary)

- A render error after streaming starts leaves a log line and a Sentry event instead of nothing.
- Normal pages, redirects, cookies and API responses behave exactly as before.
- `docs/deployment.md` no longer overstates or understates what is reported.
