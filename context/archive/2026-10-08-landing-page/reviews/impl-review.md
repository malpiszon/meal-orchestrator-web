<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Landing Page (S-09)

- **Plan**: context/changes/landing-page/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Phases 1 and 2 have their own reviews (`impl-review-phase-1.md`, `impl-review-phase-2.md`), and their fixes are in. This review checks Phase 3 and how the three phases fit together. Branch diff from merge-base `50861a6`: 18 non-context files. Every file matches a planned change or one of the deviations agreed in `change.md`. The only unplanned edits are `confirm.ts` and `set-password.ts`, from the Phase 2 review's F1 fix. Phase 3 drift: the README's smoke description got a new "landing steps" paragraph rather than an addition to the existing step list. The intent is the same, and it keeps the diff on S-09's own lines.

Success criteria, re-run at HEAD: `npm test` passes (150 tests), `npx astro check` shows 0 errors, `npm run lint` shows 0 errors (one `no-console` warning, on purpose), the build passes, the starter-leftovers grep prints nothing, and `ci.yml` parses. Smoke passes against the :4322 preview with `MAILPIT_URL` set: all 98 steps, including the 8 `landing:` steps and the real reset email. The user confirmed every manual row in the browser.

## Findings

### F1 — `POST /api/auth/signin` still skips two hard rules (`prerender = false`, zod)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:5-8
- **Detail**: Both gaps predate this change (the route at `50861a6` already lacked them). This change edits the route, though, and its neighbours `forgot-password.ts`, `set-password.ts` and `confirm.ts` all export `prerender = false` and parse input with a zod schema. `signin.ts` casts `form.get("email") as string` and calls `formData()` without `.catch`, so a POST without a form body answers 500, not a redirect. With `output: "server"` the missing `prerender` export changes nothing at runtime.
- **Fix**: Add `export const prerender = false`, and parse `{email, password}` with a small zod schema, redirecting to `?error=invalid_credentials` on failure. Or leave it as a follow-up outside S-09's scope.
- **Decision**: FIXED — `prerender = false`, zod parse of {email, password}, `formData()` catch → `?error=invalid_credentials`; new smoke step "signin rejects a body that isn't a form" (break-checked: 500 without the catch)

### F2 — The forgot-password page still renders `?error=` text from the URL

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/forgot-password.astro:8,25
- **Detail**: F9 is fixed for `/auth/signin`. `/auth/forgot-password?error=<any text>` still shows that text inside the form's alert (React escapes it, so this is text spoofing, not XSS). `set-password.ts`'s `invalidLink` and `forgot-password.ts` send free text there. The plan's "What We're NOT Doing" excludes changes to the forgot-password flow's error handling, so this is in line with the plan. It is the same class of issue as F9, on the page the landing path now links to.
- **Fix**: Record it as a follow-up (same code-map approach as `signin-errors.ts`) for a later change, not in S-09.
- **Decision**: FIXED differently (in S-09, at the user's request) — `src/lib/forgot-password-errors.ts` (codes `invalid_email`, `not_configured`, `invalid_link`, unit-tested); `forgot-password.ts` and `set-password.ts`'s `invalidLink` redirect with codes; the page renders only fixed messages; smoke expects the codes and adds a spoof step and a known-code step (break-checked: the spoof step goes red when the page renders the URL text)
