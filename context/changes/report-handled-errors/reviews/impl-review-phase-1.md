<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Handled-Error Reporting Implementation Plan

- **Plan**: context/changes/report-handled-errors/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated criteria re-run: helper tests 12/12; services 23/23 (35 across 4 files); `npm test` 247/247; `npm run lint` 0 errors, 3 `no-console` warnings (2 from the helper's intended log line, 1 pre-existing in `signin.ts`). Phase 1 has no manual criteria.

## Findings

### F1 — Supabase query errors are plain objects, so Sentry won't link the cause

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/plans.ts:38 (and every `{ cause: error }` / `{ cause: result.error }` site in plans.ts and ratings.ts)
- **Detail**: The plan's Key Discovery says that `PostgrestError` extends `Error` and can be passed as the cause directly. Its Desired End State says the event "keeps the original Supabase error as its linked cause", and probe 3.4 expects "a linked `PostgrestError` cause". In the installed postgrest-js, a PostgREST HTTP error response (any DB fault, such as 42501 or 57014) comes back as `error = JSON.parse(body)`, a plain object (`node_modules/@supabase/postgrest-js/dist/index.mjs:513`). Only transport failures and `throwOnError` produce real `PostgrestError` instances. Sentry's linked-errors integration follows `cause` only when `isError(cause)` (`@sentry/core/build/esm/utils/aggregate-errors.js:26`). So for DB faults the JS `cause` is set and the helper reads `code` and `hint` from it correctly, but the Sentry event shows no linked exception. Privacy is unaffected: `details` doesn't travel either way.
- **Fix A**: Turn the PostgREST error into a real `Error` when it is set as the cause. A small `src/lib/` helper would build `new PostgrestError({ message, code, hint, details: "" })` (exported by `@supabase/supabase-js`) and every service throw would use it.
  - Strength: Meets the plan's "linked cause" exactly, and drops `details` at the source.
  - Tradeoff: A new helper used at 7 throw sites, plus changes to the service tests' `cause` assertions (`toBe` becomes a field match). The linked cause mostly repeats what the wrapper message already says (`… failed: <code> <message>`).
  - Confidence: MED — the type is re-exported, but this hasn't been tried.
  - Blind spot: S-09/S-10 Auth errors are already real `AuthError`s, so they're unaffected.
- **Fix B ⭐ Recommended**: Keep the code as it is. Amend the plan instead: the Key Discovery, the Desired End State ("linked cause" becomes "kept as `cause`, read by the helper; Sentry links it only when it is an `Error`") and probe 3.4 (expect the wrapper exception plus `error_code`/`error_hint` tags, no linked `PostgrestError`).
  - Strength: No code change. Grouping, tags and the log line already carry the code, hint and message, and the wrapper message embeds the original message.
  - Tradeoff: The Sentry event shows one exception, not a chain, for DB faults.
  - Confidence: MED — this is a judgement on how much a duplicate linked exception is worth.
  - Blind spot: Whether the user wants the original error's type visible in the Sentry UI.
- **Decision**: FIXED via Fix B (plan amended: Key Discoveries, Desired End State, Phase 3 probe 3.4)

### F2 — Network-failure test uses a shape postgrest-js doesn't produce

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/report-handled-error.test.ts:53
- **Detail**: The test puts `status: 0` on the error object and expects `http_0`. postgrest-js puts the status on the response, not the error (`toTransportFailure`, index.mjs:3617), so a real network failure is reported as `unknown`. The empty-code skip is still covered, but the expected value documents a code (`http_0`) that never occurs.
- **Fix**: Drop `status: 0` from the test's error and expect `"unknown"`. The separate `http_502` test already covers the status fallback, which applies to Auth errors.
- **Decision**: FIXED (test now expects `unknown` for a status-less transport error)
