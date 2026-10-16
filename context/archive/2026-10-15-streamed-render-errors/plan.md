# Streamed Render Errors Implementation Plan

## Overview

An error thrown by a component after a page has started streaming gives the user a truncated page with status 200 and leaves no Sentry event and no Worker log. This change wraps each response body in the middleware so a read error is logged and sent to Sentry, then re-raised so the stream fails exactly as it does today. It is roadmap S-11 (#146) and covers audit finding X2, proven by probe P10.

## Current State Analysis

- Astro renders a page into a `ReadableStream`. A throw in a child component or island SSR happens after `next()` has returned the `Response`, so it is reported only through `controller.error(e)`, on the next tick, with no log (`node_modules/astro/dist/runtime/server/render/astro/render.js:62-72`).
- The `try/catch` in `src/middleware.ts:12-39` ends when `next()` returns. It captures frontmatter and endpoint throws (S-07) but never sees the body.
- Sentry's Worker wrapper only ends its span when the body finishes (`@sentry/cloudflare` `wrapRequestHandlerWithInit`); it does not capture a stream error.
- Streaming cannot be turned off: `@astrojs/cloudflare/dist/fetch.js` calls `createApp()` with no `streaming` option, and the default is `manifest.serverLike`. This resolves the open unknown in #146: wrapping the body in the middleware is the only route.
- Reporting pieces already in place: `captureException` with `mechanism: { handled: false, type: "auto.middleware.astro" }` in the middleware's catch; `maskEmails` (`src/lib/sentry-privacy.ts`) for log lines.
- `docs/deployment.md:92` says errors thrown in a page are reported, and `:99` says streamed-render failures are only logged until S-11. Both are inaccurate or stale after this change.

## Desired End State

- When reading a response body fails, one `console.error` line (`render.stream failed: <message>`, email-masked) is written and one Sentry event is sent: unhandled, mechanism type `auto.middleware.astro.stream`, tag `step: render.stream`, grouped by Sentry's default stack fingerprint.
- The wrapped stream then errors with the same error, so the user sees the same truncated page as today and the connection fails the same way.
- A clean stream, a redirect (null body), a client disconnect (cancel) and response status and headers are unchanged.
- `docs/deployment.md` states what is reported, with no stale "until S-11" line.
- Verified by unit tests and by re-running probe P10 on a preview build with a placeholder DSN pointed at a local listener: before the change no event, after it one event.

### Key Discoveries:

- `src/middleware.ts:12-39`: every request goes through one `onRequest`; `next()` results are returned in two places (MO prefix, and the end), so the wrapper is applied once to the final response.
- Astro calls `controller.error(e)` inside `setTimeout(…, 0)`; a reader on the wrapped stream sees the rejection from `read()`.
- Cookies are applied by the adapter's `finalize` on the outgoing response (`@astrojs/cloudflare/dist/fetch.js`), so the wrapper must keep status, statusText and headers, and the signed-in e2e run proves `Set-Cookie` still arrives.

## What We're NOT Doing

- No visible error notice or clean close after a render error; the user still gets the truncated page (decision: observability only).
- No change to Astro's `streaming` setting, the adapter or `astro.config.mjs`.
- No grouping by route or step beyond the one `render.stream` tag; no `reportHandledError` (render errors carry no code, so everything would merge into `unknown`).
- No permanent throwing route or CI probe; P10 is a one-off run with a temporary, uncommitted throwing component.
- No alert rules.

## Implementation Approach

A pure helper in `src/lib/` takes a `Response`, returns it unchanged when `body` is null, otherwise returns a new `Response` with the same status, statusText and headers whose body is a `ReadableStream` that pulls from the original reader. A read error is reported, then the new stream is errored with it. `cancel` cancels the original reader, so client disconnects still stop the render. The middleware applies it to the response `next()` produced (including the MO branch and error-handler pages), inside the existing structure.

## Phase 1: Capture stream errors in the middleware

### Overview

Add the helper, wire it into the middleware and cover it with unit tests.

### Changes Required:

#### 1. Stream-capture helper

**File**: `src/lib/report-stream-errors.ts` (new)

**Intent**: Wrap a response body so a read failure is reported once, then re-raised unchanged.

**Contract**: `captureStreamErrors(response: Response): Response`. Null body returns the same `Response`. Otherwise a new `Response(stream, { status, statusText, headers })`. On a failing `read()`: `console.error("render.stream failed: " + maskEmails(message), maskEmails(stack))`, then `captureException(error, { mechanism: { handled: false, type: "auto.middleware.astro.stream" }, tags: { step: "render.stream" } })`, then the wrapper stream is errored with the original error. `cancel(reason)` forwards to the source reader. A non-Error rejection is wrapped in an `Error` before capture (as `reportHandledError` does), never sent whole.

#### 2. Middleware wiring

**File**: `src/middleware.ts`

**Intent**: Make every response body that `next()` returns go through the helper, so page, error-page and streamed route bodies are covered.

**Contract**: both `return await next()` sites return `captureStreamErrors(await next())`; the redirect path (`context.redirect`) is untouched. The existing catch is unchanged. Update the top comment to say the catch covers errors before streaming and the wrapper covers errors during it.

#### 3. Unit tests

**File**: `src/lib/report-stream-errors.test.ts` (new)

**Intent**: Prove the behaviours the decisions rely on.

**Contract**: Vitest with `@sentry/cloudflare` mocked like `report-handled-error.test.ts`. Cases: an error after some chunks is captured once with the `render.stream` tag and handled:false, and the reader of the wrapped stream receives the same chunks then the same error; a clean stream is delivered intact and nothing is captured; a null-body response is returned as the same object; status, statusText and headers are preserved; `cancel` reaches the source stream's cancel; an email in the message is masked in the log line; a non-Error rejection is captured as an `Error`.

### Success Criteria:

#### Automated Verification:

- Helper unit tests pass: `npx vitest run src/lib/report-stream-errors.test.ts`
- Full unit suite passes: `npm test`
- Linting and types pass: `npm run lint`

#### Manual Verification:

- Reading the middleware diff: both `next()` returns are wrapped, redirects and the catch are untouched.

---

## Phase 2: Prove with probe P10 and fix the docs

### Overview

Show the gap before and the capture after on a real Workers build, then correct the docs.

### Changes Required:

#### 1. Probe P10 and result

**File**: `context/changes/streamed-render-errors/probe-p10.md` (new)

**Intent**: Record the before and after evidence that the fix works on the Cloudflare runtime.

**Contract**: On port 4323 (`ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4323`, per `CLAUDE.local.md`), with a temporary component that throws after about 250 KB has streamed, added to a page and **not committed**. The build sets `PUBLIC_SENTRY_DSN` to a placeholder DSN whose host is a local listener that records each envelope it receives (in the scratchpad, never committed). Sentry flushes an HTML response as soon as the handler returns it, so a stream error is captured after the flush. The probe must show the late event actually arrives, with `step: render.stream` and mechanism `auto.middleware.astro.stream` (review F1, `reviews/impl-review-phase-1.md`). Note the commands, the response status and body tail, the log line and the received event, both on the pre-change build (no log, no event) and the post-change build.

#### 2. Docs

**File**: `docs/deployment.md`

**Intent**: Say exactly what is reported.

**Contract**: § Error monitoring (Sentry), **Reported**: the first bullet adds that an error thrown while a page streams is reported too (mechanism `auto.middleware.astro.stream`, tag `step: render.stream`, one Worker log line `render.stream failed: <message>`), and that the user still sees a truncated page. **Not reported** paragraph: remove "Invitation and streamed-render failures are only logged until S-10 and S-11" and keep the invitation part, reworded to name only S-10 while it is open.

#### 3. Local gates

**Intent**: Nothing else regressed.

**Contract**: Run lint, the unit suite and the smoke against the 4323 preview.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Smoke passes against the preview: `BASE_URL=http://localhost:4323 npm run smoke`
- E2E passes (cookies still set, pages hydrate): `E2E_PORT=4323 npm run test:e2e`

#### Manual Verification:

- P10 before the change: status 200, truncated body, no log line (recorded in `probe-p10.md`).
- P10 after the change: status 200, truncated body, one `render.stream failed:` log line, and the throwing component is removed again (`git status` clean of it).
- P10 after the change: the local DSN listener receives one event tagged `step: render.stream`, mechanism `auto.middleware.astro.stream`, handled false.
- `docs/deployment.md` reads correctly, with no leftover "until S-11".

---

## Testing Strategy

### Unit Tests:

- The helper, per Phase 1 item 3.

### Integration Tests:

- Existing smoke and e2e prove that wrapping changes nothing for normal responses (status, headers, `Set-Cookie`, hydration).

### Manual Testing Steps:

1. Add the temporary throwing component to a page, build and preview on 4323.
2. `curl -si` the page; note status, body tail and the Worker log.
3. Repeat on the pre-change build for the "before" record.
4. Remove the component.

## Performance Considerations

One extra pass-through stream per response; chunks are forwarded as received, with no buffering, so time to first byte is unchanged.

## Migration Notes

None: no schema, secret or deploy-order change.

## References

- Roadmap: `context/foundation/roadmap.md` § S-11; issue #146
- Audit: `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §5 (X2, P10), §6 item 4
- Astro stream error: `node_modules/astro/dist/runtime/server/render/astro/render.js:62-72`
- Existing pattern: `src/middleware.ts:35-38`, `src/lib/report-handled-error.ts`, `src/lib/report-handled-error.test.ts`
- Phase sub-issues: #166 (Phase 1), #167 (Phase 2, blocked by #166)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Capture stream errors in the middleware

#### Automated

- [x] 1.1 Helper unit tests pass: `npx vitest run src/lib/report-stream-errors.test.ts` — 99cc47b
- [x] 1.2 Full unit suite passes: `npm test` — 99cc47b
- [x] 1.3 Linting and types pass: `npm run lint` — 99cc47b

#### Manual

- [x] 1.4 Reading the middleware diff: both `next()` returns are wrapped, redirects and the catch are untouched. — 99cc47b

### Phase 2: Prove with probe P10 and fix the docs

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 9f931b3
- [x] 2.2 Unit tests pass: `npm test` — 9f931b3
- [x] 2.3 Smoke passes against the preview: `BASE_URL=http://localhost:4323 npm run smoke` — 9f931b3
- [x] 2.4 E2E passes (cookies still set, pages hydrate): `E2E_PORT=4323 npm run test:e2e` — 9f931b3

#### Manual

- [x] 2.5 P10 before the change: status 200, truncated body, no log line (recorded in `probe-p10.md`). — 9f931b3
- [x] 2.6 P10 after the change: status 200, truncated body, one `render.stream failed:` log line, and the throwing component is removed again (`git status` clean of it). — 9f931b3
- [x] 2.7 `docs/deployment.md` reads correctly, with no leftover "until S-11". — 9f931b3
- [x] 2.8 P10 after the change: the local DSN listener receives one event tagged `step: render.stream`, mechanism `auto.middleware.astro.stream`, handled false. — 9f931b3
