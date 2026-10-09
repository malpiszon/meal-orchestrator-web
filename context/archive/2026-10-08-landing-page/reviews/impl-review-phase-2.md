<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Landing Page (S-09)

- **Plan**: context/changes/landing-page/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Two other routes still send free text to `/auth/signin?error=`, which the page now hides

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/confirm.ts:16, src/pages/api/auth/set-password.ts:27
- **Detail**: `/api/auth/confirm` with a malformed link query redirects to `/auth/signin?error=This%20link%20is%20invalid…`, and `POST /api/auth/set-password` without Supabase redirects to `/auth/signin?error=Supabase%20is%20not%20configured`. Before Phase 2 the sign-in page showed that text. `signInErrorMessage` now returns `null` for both, so the user lands on a plain sign-in form with no explanation. The plan only looked at `signin.ts`. No smoke step covers either redirect.
- **Fix A ⭐ Recommended**: Add an `invalid_link` code ("This link is invalid or has expired. Ask for a new one.") to `signin-errors.ts`. `confirm.ts` then redirects with `?error=invalid_link` and `set-password.ts` with `?error=not_configured`. Add unit tests for the new code.
  - Strength: The message comes back, and every redirect to the sign-in page uses a code, which completes F9 for that page.
  - Tradeoff: A fifth code, two lines in routes the plan said it would not touch.
  - Confidence: HIGH — same mechanism as the four planned codes.
  - Blind spot: Not checked whether MO or old emails ever produce a malformed confirm query in practice.
- **Fix B**: Send `confirm.ts`'s invalid query to `/auth/forgot-password?error=…` (as `set-password.ts`'s `invalidLink` already does), and `set-password.ts`'s not-configured case to `/auth/signin?error=not_configured`.
  - Strength: The user lands where they can ask for a new link, and the sign-in codes stay at four.
  - Tradeoff: The forgot-password page still renders URL text, so this moves the reflected text instead of removing it.
  - Confidence: MED — changes where an old-link user lands.
  - Blind spot: The forgot-password page's own handling of `?error=` was not reviewed.
- **Decision**: FIXED via Fix A — `invalid_link` code with tests; `confirm.ts` → `?error=invalid_link`, `set-password.ts` → `?error=not_configured`; new smoke step for a malformed confirm link

### F2 — Smoke still expects sign-in to land on `/` after the reset

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:1090
- **Detail**: "signin accepts the new password" expects location `/`. Since Phase 1 sign-in redirects to `/dashboard`, and the step passes only because the location check is a prefix match.
- **Fix**: Expect `/dashboard`.
- **Decision**: FIXED — expects `/dashboard`
