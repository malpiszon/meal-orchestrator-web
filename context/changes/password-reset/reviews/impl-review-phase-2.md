<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Password reset

- **Plan**: context/changes/password-reset/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Agreed deviations, not findings: `Referrer-Policy: strict-origin` instead of `no-referrer`, because `no-referrer` makes browsers send `Origin: null` and `checkOrigin` then answers 403; the reset email's text and subject now say "Set a new password"; the new route is added to the ESLint worker files; the Phase 1 review's F4 (shared token and link-type rules) is applied. Automated checks were re-run during this review: `npm test` (97/97), `npm run lint`, `npx astro check` (0 errors) and `npm run build` all pass. Manual checks 2.5–2.8 were confirmed by the user, and 2.8 used a delivery-created account (`s05-claim@example.com`).

## Findings

### F1 — Any signed-in session can set a new password without the token or the old password

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/set-password.astro:27, src/pages/api/auth/set-password.ts:64
- **Detail**: The planned retry path ("no token but a session") is open to every session, not only to one in the middle of a reset. A user can go straight to `/auth/set-password`, and `secure_password_change = false` (`supabase/config.toml:211`) means GoTrue doesn't ask for reauthentication either. So a stolen session cookie can be turned into a permanent account takeover. In practice this is a change-password screen without reauthentication, which goes against the plan's "No change-password screen for signed-in users".
- **Fix A ⭐ Recommended**: Allow the token-less path only right after a reset. When `updateUser` fails after a successful `verifyOtp`, set a short-lived (about 10 minutes), httpOnly, `SameSite=Lax` "reset in progress" cookie. The page and the route then accept a session without a token only while that cookie exists, and a successful save clears it.
  - Strength: Keeps the planned retry, and stops the page from working as a general change-password screen.
  - Tradeoff: One more cookie and a small branch in two files, plus a smoke step to prove it in Phase 3.
  - Confidence: MED — straightforward, but the cookie's lifetime is a judgement call.
  - Blind spot: Not checked against S-04's invite retry, which will need the same gate.
- **Fix B**: Accept the behaviour as standard Supabase behaviour, and record it in the plan's risks and the S-04 handoff.
  - Strength: No code change.
  - Tradeoff: Anyone with a stolen session gets an easy way to take over the account until something like `secure_password_change` is turned on.
  - Confidence: HIGH — it's a documentation change.
  - Blind spot: Whether hosted production has `secure_password_change` enabled hasn't been checked.
- **Decision**: FIXED (Fix A) — `mo-password-retry` cookie (httpOnly, SameSite=Lax, 10 min, holds the user id) is set only when saving fails right after `verifyOtp`; the page and route accept a token-less save only with it; a successful save deletes it. Verified on the :4322 preview. A smoke step is queued for Phase 3.

### F2 — CI smoke is red on this branch until Phase 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:447-471
- **Detail**: F-01's smoke steps still expect `/api/auth/confirm?…&type=recovery` to sign the user in and redirect to `/dashboard`, and expect a reused link to go to `/auth/signin?error=`. Both now forward to `/auth/set-password`. Phase 3, item 1, rewrites these steps.
- **Fix**: Don't push the branch or open the PR before Phase 3 lands, or accept a red smoke job until then.
- **Decision**: FIXED — accepted: the branch stays unpushed until Phase 3 rewrites the smoke steps (queued in follow-ups).

### F3 — The unused reset token appears in Workers request logs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/set-password.astro, wrangler.jsonc:15
- **Detail**: With `observability.enabled`, Workers logs record request URLs. Before this change the token in a logged URL was already used. Now `/api/auth/confirm` and `/auth/set-password` log a token that is still unused and valid for up to `otp_expiry` (3600 s). Only account admins can read those logs.
- **Fix**: Accept, and note it in the plan's risks. A later change could move the token into the URL fragment.
- **Decision**: FIXED — accepted as a risk, noted in follow-ups for Phase 3 (plan risks / README). A later change could move the token into the URL fragment.

### F4 — No maximum password length

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/set-password.ts:59
- **Detail**: GoTrue rejects passwords over 72 characters. That error code isn't in `passwordErrorMessage`, so the user sees "Something went wrong".
- **Fix**: Add `.max(72)` with a clear message to `setPasswordFormSchema` and to the form's client-side check.
- **Decision**: FIXED — `MAX_PASSWORD_BYTES = 72` (UTF-8 bytes, as GoTrue counts) in the schema, the form's client check and the route's error message; unit tests added.

### F5 — Docs still describe the old reset link and `AUTH_LINK_DESTINATION`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md:161,289,296,332; context/foundation/infrastructure.md:117; context/foundation/roadmap.md:93
- **Detail**: The README still says reset links sign the user in through `/api/auth/confirm`, and still gives the old subject "Reset your Meal Orchestrator password". `infrastructure.md` and the F-01 handoff in the roadmap name the removed constant.
- **Fix**: Cover these in Phase 3's README pass, using the new subject "Set a new Meal Orchestrator password", and update the `infrastructure.md` line.
- **Decision**: FIXED — queued for Phase 3's README pass (follow-ups), including `infrastructure.md` and the new subject.
