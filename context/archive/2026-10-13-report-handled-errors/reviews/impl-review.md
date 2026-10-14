<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Handled-Error Reporting

- **Plan**: context/changes/report-handled-errors/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Every planned change in Phases 1–3 matches its contract, and the docs describe the code accurately: the step list, levels, tags, log format, 503 pages and the Dedupe note. Nothing touches the S-09, S-10 or S-11 sites. The only files outside the plan are the `roadmap.md` status flip and the change's own `context/` files.

Automated criteria were all re-run:

- Helper, service and set-password tests: 83/83.
- `npm test`: 257/257.
- `npm run lint`: 0 errors (the 3 known `no-console` warnings).
- The bare-`console.error` grep and the old-prefix grep both print nothing.
- Prettier passes.

The build and smoke passed at Phase 2. Manual checks 3.3–3.8 were run in-session against a local listener, and the envelopes are on record in the session.

## Findings

### F1 — A plain-object error passed to the helper would send `details` to Sentry

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-handled-error.ts:67
- **Detail**: `captureException(error, …)` receives `error` as given. For a plain object, which is what postgrest-js returns as `result.error` for a database fault, Sentry's event builder stores the whole object as `extra.__serialized__` (`@sentry/core` `eventbuilder.js:69-71`). That includes `details`, which can echo row values such as an email. `scrubEvent` doesn't touch `extra`, and the log line would read `[object Object]`. No current call site does this, because every caller passes an `Error` (services and `deliveries.ts` wrap). But the helper's contract and its "never reads details" test suggest `reportHandledError(step, result.error)` is safe, and S-09 and S-10 will add callers.
- **Fix**: In the helper, wrap a non-`Error` input as `new Error(\`<message>\`, { cause: error })`before logging and capturing, reading`message`from the object. Add a test that passes a plain object with`details`and asserts the captured first argument is an`Error`and contains no`details`.
- **Decision**: FIXED (helper wraps a non-Error input as `Error("<step> failed: <code> <message>", { cause })`; test added, break-checked)

### F2 — The cause-chain cycle guard and non-string codes are untested

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-handled-error.ts:10-19, src/lib/report-handled-error.test.ts
- **Detail**: The `chain.includes(current)` check and `MAX_CAUSE_DEPTH` prevent a loop, and a non-string `code` falls back correctly. But no test covers a self-referential cause (`e.cause = e`) or a numeric `code`.
- **Fix**: Add two small tests: a cyclic cause (code found, no hang) and a numeric `code` (falls back to `http_<status>` or `unknown`).
- **Decision**: FIXED (tests for a cyclic cause and a numeric code; break-checked: red with both loop guards removed, and with the string check removed)

### F3 — The plan's probe 3.4 still expects one event per reload

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/report-handled-errors/plan.md:266
- **Detail**: The probe reads "Three reloads give three events with the same fingerprint". In the run, 3 reloads gave 2 events and 4 reloads gave 1. Sentry's Dedupe integration drops an event identical to the previous one from the same isolate, because `@sentry/cloudflare` caches one client per isolate. `docs/deployment.md` now says so, which leaves the plan as the stale side.
- **Fix**: Add a one-line note under the probe saying that Dedupe can drop repeats, so reloads give at least one event with that fingerprint.
- **Decision**: FIXED (review note added under probe 3.4 in plan.md)
