<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Password reset

- **Plan**: context/changes/password-reset/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria: `npm test` (92 passed), `npm run lint`, `npx astro check` (0 errors), `npm run build` all re-run green on 882a8b6. Manual 1.5–1.7 confirmed by the user in session.

## Findings

### F1 — Rate-limit answer reveals which emails have accounts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/forgot-password.ts:29-32, src/lib/set-password.ts (`over_email_send_rate_limit` / 429 mapping)
- **Detail**: GoTrue answers 200 for an unknown email without sending anything, but for a known email it sends, so a repeat within `max_frequency` (1s locally, ~60s hosted) or past the project email cap returns 429 `over_email_send_rate_limit`. The route turns that into "Too many requests", so two quick submissions tell a known email from an unknown one. Any other Supabase error (e.g. SMTP failure) also only happens for known emails. This contradicts the plan's "never reveals which emails exist" goal; the plan itself asked for the rate-limit message, so this is a plan flaw.
- **Fix A ⭐ Recommended**: On any `resetPasswordForEmail` error, log it and redirect to `?sent=1` like a success; keep the rate-limit mapping in `passwordErrorMessage` for the set-password flow only.
  - Strength: Restores the identical answer for every email; simplest change (one branch).
  - Tradeoff: A real outage (SMTP down) looks like success to the user; only Worker logs show it.
  - Confidence: HIGH — GoTrue's per-user `max_frequency` check only runs for existing users.
  - Blind spot: Haven't checked whether hosted Supabase returns a non-429 error class that is account-independent (e.g. config errors) and would be worth surfacing.
- **Fix B**: Show errors only when they are account-independent (unconfigured Supabase, 5xx network failure before GoTrue answers), and map 429 and GoTrue user-path errors to `?sent=1`.
  - Strength: Users still see outages that affect everyone.
  - Tradeoff: Requires classifying GoTrue errors; misclassification re-opens the leak.
  - Confidence: MED — error codes are not exhaustively documented.
  - Blind spot: SMTP failures surface as 500 only for existing users, so they must stay hidden anyway.
- **Decision**: FIXED (Fix A)

### F2 — zod now ships in sign-in and sign-up page JavaScript

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/SignInForm.tsx:8, src/components/auth/SignUpForm.tsx:7
- **Detail**: Both islands import constants from `@/lib/set-password`, which builds zod schemas at module top level. The build emits `dist/client/_astro/set-password.CIonag4D.js` (~80 KB raw, contains `ZodError`) loaded by both forms. Before this commit no client bundle loaded zod; the forms only need `MIN_PASSWORD_LENGTH` and `FORGOT_PASSWORD_PATH`.
- **Fix**: Move the plain constants (`MIN_PASSWORD_LENGTH`, `FORGOT_PASSWORD_PATH`, `SET_PASSWORD_PATH`) to a zod-free module (e.g. `src/lib/password-rules.ts`), import it from the forms and from `set-password.ts`.
- **Decision**: FIXED

### F3 — Non-form POST to the reset route returns 500

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/forgot-password.ts:16
- **Detail**: `await context.request.formData()` throws on a JSON or empty body (checkOrigin only checks form content types), giving an unhandled 500. `signin.ts`/`signup.ts` behave the same, so this matches existing patterns.
- **Fix**: Wrap `formData()` in try/catch and redirect with "Enter a valid email address".
- **Decision**: FIXED

### F4 — Link-type schema duplicates `authLinkQuerySchema`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/set-password.ts:19-25, src/lib/auth-link.ts:8
- **Detail**: `setPasswordLinkSchema` repeats the `token_hash` rule and a subset of the type enum from `authLinkQuerySchema`. Phase 2 makes `auth-link.ts` forward `recovery` to the set-password page, and S-04 adds `invite` to both, so the two can drift.
- **Fix**: In Phase 2, build one from the other (share the `token_hash` rule and reuse the set-password type enum in `auth-link.ts`).
- **Decision**: FIXED — queued for Phase 2 in follow-ups/review-fixes.md

### F5 — Small unplanned additions (eslint allowlist, "Back to sign in" in both states)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:82-90, src/pages/auth/forgot-password.astro:24-28
- **Detail**: The route was added to the `no-console: off` worker allowlist (needed for the planned logging; same pattern as `confirm.ts`), and the "Back to sign in" link shows in the form state too, not only after `?sent=1`. Both benign.
- **Fix**: Accept as-is; no plan change needed.
- **Decision**: ACCEPTED — both additions kept as they are
