<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Critical-journey e2e as a CI gate (S-04)

- **Plan**: context/changes/testing-critical-journey-e2e/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Set-password retry can submit the one-time link twice

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/critical-journey.spec.ts:57-62 (same shape in tests/e2e/support/auth.ts signIn)
- **Detail**: `SetPasswordForm` is a native POST form whose button stays enabled. If the first submit succeeds but takes longer than the 5 s `waitForURL` (verifyOtp + updateUser + first dashboard SSR on a cold CI worker), the next `toPass` iteration re-submits the consumed `token_hash`; the route redirects to `/auth/forgot-password?error=invalid_link`, which passes the URL predicate, and the step fails on "Your meals". If navigation lands between iterations, the next `fill` targets a missing label and hangs to the test timeout. In `signIn` a resubmit is harmless (idempotent), but the hang case applies.
- **Fix A ⭐ Recommended**: Wait for the island to hydrate once (`astro-island` for the form loses its `ssr` attribute), then fill and submit exactly once; put it in a `setPassword` helper next to `signIn` and use the same wait in `signIn`.
  - Strength: Removes the retry-after-success class entirely; one place to maintain.
  - Tradeoff: Couples the tests to Astro's island markup (`astro-island[ssr]`).
  - Confidence: MED — Astro removes `ssr` after hydration; not yet verified on Astro 7 here.
  - Blind spot: Whether Astro 7 still uses the `ssr` attribute.
- **Fix B**: Keep the retry, but return early when the URL has already left the form page, and give the fills a short timeout.
  - Strength: Minimal edit, no dependency on Astro internals.
  - Tradeoff: Still racy in theory (a submit in flight while the iteration times out).
  - Confidence: HIGH — straightforward guard.
  - Blind spot: None significant.
- **Decision**: FIXED — Fix A: waitForHydration (astro-island loses `ssr`) + single submit; setPassword helper in tests/e2e/support/auth.ts, signIn uses the same wait

### F2 — Journey relies on the default 30 s test timeout

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/critical-journey.spec.ts:34
- **Detail**: Every `toPass()` is unbounded except by the test timeout; Mailpit polling alone may take up to 15 s. Locally the journey takes ~2 s, but on a cold CI preview it could approach 30 s and fail as a generic timeout rather than naming a step.
- **Fix**: Add `test.slow()` (90 s) to the journey.
- **Decision**: FIXED — `test.slow()` in the journey

### F3 — Slot and meal locators use substring matching

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/critical-journey.spec.ts:86
- **Detail**: `getByRole("group", { name: slotName })` and `getByRole("radio", { name: mealName })` match substrings. Fine with today's fixture (Monday has breakfast and lunch, distinct names), but "Breakfast" would also match "Second breakfast" and a meal name contained in another label would collide (strict-mode error, fails loudly).
- **Fix**: `exact: true` on the group; pin the radio by its `value` (option id) instead of its name.
- **Decision**: FIXED — swapped radio pinned by its option id (`value`), slot/meal-name lookups removed (plan step 5 "remember the meal's name" now remembers the option id)

### F4 — Journey email uses Date.now()

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/critical-journey.spec.ts:39
- **Detail**: `e2e-journey-${Date.now()}` can collide under `--repeat-each` or several local workers in the same millisecond. The plan named this format.
- **Fix**: Use `randomUUID()` (already imported) in the email.
- **Decision**: FIXED — email is `e2e-journey-<uuid>@example.com`

### F5 — Traces record typed passwords

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/auth.setup.ts, tests/e2e/critical-journey.spec.ts:40
- **Detail**: Traces record `fill` values, so a trace holds `E2E_PASSWORD` and the journey password. Phase 3 uploads `playwright-report/` and `test-results/` on failure. Both are test-only credentials on a throwaway CI stack, so the exposure is nil, but it should be a conscious choice.
- **Fix**: In Phase 3, keep the CI `E2E_PASSWORD` a test-only value and note in docs/testing.md that traces contain it.
- **Decision**: FIXED — queued for Phase 3 in follow-ups/review-fixes.md
