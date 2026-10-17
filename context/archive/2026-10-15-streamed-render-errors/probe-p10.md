# Probe P10: error while a page streams

Run 2026-10-16 on the Cloudflare runtime (`astro preview`, workerd), `@sentry/cloudflare` 11.6.0. Plan Phase 2 item 1; audit `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §3 P10.

## Setup (none of it committed)

- `src/components/ProbeThrow.astro`: frontmatter waits 50 ms, then throws `Error("probe P10: render failed for probe@example.com")`.
- `src/pages/auth/signin.astro`: after the card, `<div hidden>{"x".repeat(250_000)}</div><ProbeThrow />`, so about 256 KB has streamed when the component throws.
- Fake Sentry ingest: a Node listener on `127.0.0.1:9910` that writes each envelope it receives to a JSONL file (scratchpad).
- DSN: `PUBLIC_SENTRY_DSN=http://p10probekey@127.0.0.1:9910/1`, appended to `.dev.vars` for the run (the build copies it to `dist/server/.dev.vars`, which the preview reads as the Worker's vars) and passed to `astro build` for the client bundle. `.dev.vars` was restored afterwards.
- Commands per run:

  ```bash
  PUBLIC_SENTRY_DSN=http://p10probekey@127.0.0.1:9910/1 npx astro build
  node listener.mjs 9910 envelopes.jsonl &
  ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4323 &
  curl -s -D headers.txt -o body.html http://localhost:4323/auth/signin
  ```

## Before (middleware from `f038595`, no stream wrapper)

`src/middleware.ts` temporarily replaced with `git show f038595:src/middleware.ts`, then restored.

- Response: `HTTP/1.1 200 OK`, body 262,272 bytes ending `xxxx…</div>`, no `</html>`.
- Worker log: no app line; only workerd's own `Uncaught exception: … remote.jsg.Error: probe P10: render failed for probe@example.com` (unmasked).
- Listener: 0 envelopes.

## After, Phase 1 helper as committed (`9d0a15d`)

- Response: 200, same 262,272-byte truncated body.
- Worker log: `render.stream failed: probe P10: render failed for [email]` plus the masked stack, then workerd's `Uncaught exception` line.
- Listener: **0 envelopes**: the event was lost.

Cause, from a diagnostic `console.error(!!getClient())` patched into the built middleware: the body is read outside the request's async context, where no Sentry client is current, both outside and inside the pinned isolation scope (`outer client false`, `inner client false`). The client sits on the request's current scope, which Phase 1 did not pin, so `captureException` did nothing. This is the gap review F1 suspected, but in a different place: the send was never started, so `waitUntil` didn't matter yet.

## Fix (Phase 2 adaptation)

`src/lib/report-stream-errors.ts` also takes `getCurrentScope()` when it wraps the body, and reports inside `withIsolationScope(isolationScope, () => withScope(currentScope, () => withScope((scope) => …)))`. The innermost `withScope` still forks, so the `step` tag never lands on the request's scope. The unit test now asserts that the capture runs in both scopes taken at wrap time. Patched into the built middleware first: `inner client true`, one envelope received.

## After, with the fix (clean build from source)

- Response: `HTTP/1.1 200 OK`, `content-type: text/html`, `transfer-encoding: chunked`, body 262,272 bytes, no `</html>`: the user sees the same truncated page as before.
- Worker log: one `render.stream failed: probe P10: render failed for [email]` line with the masked stack, then workerd's `Uncaught exception` line.
- Listener: 1 envelope, 1 event:

  ```json
  {
    "level": "error",
    "tags": { "step": "render.stream" },
    "environment": "production",
    "mechanism": { "type": "auto.middleware.astro.stream", "handled": false },
    "type": "Error",
    "value": "probe P10: render failed for [email]",
    "url": "http://localhost:4323/auth/signin",
    "topFrame": { "filename": ".../dist/server/chunks/signin_DedEKnQi.mjs", "lineno": 126 }
  }
  ```

  The raw envelope has no `probe@example.com`; the request URL and headers (filtered) come from the request's isolation scope.

## Limits

- Local workerd only. Production timing of the late send (registered with the request's `waitUntil` after the response body has errored) is not observed here; the first real stream error in Sentry confirms it.
- The probe component and the page edit were removed after the run (`git status` clean of them).
