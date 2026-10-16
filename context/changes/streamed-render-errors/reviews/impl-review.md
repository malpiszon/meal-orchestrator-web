<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Streamed Render Errors Implementation Plan

- **Plan**: context/changes/streamed-render-errors/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Plan adherence: all five planned items MATCH (`99cc47b`, `9d0a15d`, `9f931b3`). Deviations are the accepted Phase 1 review fixes (F1–F4 in `impl-review-phase-1.md`) and the Phase 2 adaptation the user approved: the helper also pins `getCurrentScope()`, because P10 showed that no Sentry client is current when the body is read (`probe-p10.md`). The scope nesting was verified against `@sentry/core` 11.6.0 and the AsyncLocalStorage strategy:

- the two-argument `withScope` sets the given scope as current, without forking;
- the inner `withScope(cb)` clones it, so the `step` tag never reaches the request scope;
- `getInvocationState()` reads the pinned isolation scope.

The extra files are benign: the `eslint.config.js` allowlist, the `messageOf` export, the roadmap set to `in-progress`, and the change's own context files. Success criteria re-run:

- helper tests: 9/9
- `npm test`: 370/370
- `npm run lint`: 0 errors (2 warnings that were already there)
- smoke: all steps pass on 4323
- e2e: 3/3 on 4323
- `astro check`: 0 errors

Manual items 2.5–2.8 are backed by `probe-p10.md`, and the scratchpad logs and envelopes were re-checked before ticking.

## Findings

### F1 — A report that throws replaces the original stream error

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-stream-errors.ts:64-67
- **Detail**: `reportStreamError` runs before `controller.error(error)`. If it throws, the pull promise rejects, the wrapper errors with the thrown error instead of the original, and nothing is reported. It can throw when `messageOf`'s `String(error)` hits an object with a throwing `toString` or `Object.create(null)`, or when `maskEmails` gets a non-string `stack`. The stream does not hang; a subagent checked this in Node.
- **Fix**: `try { reportStreamError(error, scopes); } finally { controller.error(error); }`.
- **Decision**: FIXED — `controller.error(error)` in a `finally`; new test "passes the original error on even when reporting it throws" (went red on the old ordering).

### F2 — Set-Cookie test covers a single cookie only

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-stream-errors.test.ts:136-147
- **Detail**: Cookies are attached by Astro after the middleware returns (`astro-middleware.js:51-56`), so the wrapper is the response that carries them, and e2e proves the sign-in cookie arrives. The unit test, though, asserts one `set-cookie` value. Copying `Headers` keeps several values (checked in Node with `getSetCookie()`), but nothing guards it.
- **Fix**: Add a second cookie and assert `wrapped.headers.getSetCookie()` returns both.
- **Decision**: FIXED — headers test appends two cookies and asserts `getSetCookie()`.

### F3 — eslint comment says streamed renders are only observable in Workers Logs

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: eslint.config.js:82-84
- **Detail**: Phase 1 added "failed streamed renders" to the list of things "only observable through Workers Logs", but they now also reach Sentry. The rest of that list has been stale since S-08/S-09 (saves and loads are reported too).
- **Fix**: Drop "failed streamed renders" from the "only observable" sentence, and leave the older entries for a separate cleanup.
- **Decision**: FIXED — "failed streamed renders" dropped from the comment; older stale entries left for a separate cleanup.

### F4 — Middleware comment implies only MO responses skip the wrapper's cost

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.ts:19,44
- **Detail**: The MO-branch comment says wrapping "would drop its Content-Length". The other JSON routes (`/api/ratings`, `/api/plans/*`, `/api/auth/*`) are still wrapped and go out chunked. That is harmless for small JSON and was the plan's deliberate "no content-type guessing" choice, but a reader could think only HTML is wrapped.
- **Fix**: At the main wrap site, add that every non-MO body is wrapped, JSON routes included (harmless; they go out chunked).
- **Decision**: FIXED — comment at the main wrap site says every non-MO body is wrapped, JSON routes included.
