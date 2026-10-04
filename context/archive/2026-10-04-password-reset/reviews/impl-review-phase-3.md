<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Password reset

- **Plan**: context/changes/password-reset/plan.md
- **Scope**: Phase 3 of 3
- **Reviewed phases**: 3
- **Date**: 2026-10-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence: every planned smoke step, the CI `MAILPIT_URL` wiring, the README contract, the S-04 handoff (roadmap S-04 block and #8 comment) and the queued fixes F1/F3/F5 from Phase 2 match the plan. Extras are needed support (Mailpit taken out of the CI `-x` list, `INBUCKET_URL` fallback) or accurate docs. `npm run lint` passes; smoke passed locally on :4322 with Mailpit and in CI on PR #54 and on the merge commit 28f928b (including the real-email steps). Manual rows 3.4/3.5 were confirmed by the user after the production reset (email link `/auth/set-password?…&type=recovery`); 3.6 is backed by roadmap.md:171 and the #8 comment.

## Findings

### F1 — Real-reset-email step can trip GoTrue's 1 s send frequency

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:713
- **Detail**: The `same_password` step (L654) calls Admin `generate_link` type=recovery for the smoke user, which sets `recovery_sent_at`. A few fast requests later, L713 calls `/recover` for the same user; GoTrue refuses a send within `auth.email.max_frequency = "1s"` (supabase/config.toml:213). `/api/auth/forgot-password` swallows that error and still answers `?sent=1` by design, so the failure appears 10 s later at L721 as "no email … arrived in Mailpit", which points away from the cause. Passed in 3 runs so far, but the margin is the speed of ~4 requests.
- **Fix**: `await sleep(1500)` before `requestReset(email)` in the L713 step, and make the "no email arrived" message mention GoTrue's rate limits (`max_frequency`, `email_sent`).
- **Decision**: FIXED — 1.5 s wait before `requestReset(email)` plus a rate-limit hint in the no-email message

### F2 — Mailpit read errors all reported as "unreachable"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:313-331
- **Detail**: The message fetch (L326) doesn't check `.ok`, and the catch around the poll reports any exception (JSON parse, `new URL` on a relative href) as "Mailpit … is unreachable".
- **Fix**: Check `.ok` on the message fetch and word the catch as "Mailpit read failed: <message>".
- **Decision**: FIXED — `.ok` check on the message fetch; catch reworded to "Mailpit read … failed"

### F3 — README overstates where a bad link ends up

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md:166
- **Detail**: Says a used, expired or made-up link "ends on `/auth/forgot-password`". True on the form POST; on the GET a malformed/missing token shows the invalid-link message on `/auth/set-password` itself, and a used-but-well-formed token still shows the form (by design: the token is not checked on GET).
- **Fix**: Reword to "posting the form with a used, expired or made-up link ends on `/auth/forgot-password`; a link without a token shows the invalid-link message on the page".
- **Decision**: FIXED — README reworded: posting the form with a bad link ends on forgot-password; a token-less link shows the message on the page

### F4 — Smoke cookie jar ignores negative Max-Age and Max-Age precedence

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:26-30
- **Detail**: Handles today's servers (Supabase `Max-Age=0`, Astro `Expires=1970`). Per RFC 6265 a negative `Max-Age` should also delete, and `Max-Age` should win over `Expires`; neither occurs now.
- **Fix**: Parse Max-Age as a number, treat `<= 0` as expired, and prefer it over Expires.
- **Decision**: FIXED — Max-Age parsed as a number (<= 0 deletes) and preferred over Expires

### F5 — PGRST303 reproduced on plain sign-in, not only after a reset

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro (pre-existing; handoff in context/foundation/roadmap.md:171)
- **Detail**: The first local smoke run in Phase 3 failed "dashboard shows no upcoming plan yet" with `weekly_plans query failed: PGRST303 JWT issued at future` right after an ordinary sign-in (likely WSL/Docker clock skew). The handoff says "not reproduced in 15 scripted runs" and frames it as post-reset; it is broader and can make smoke flaky. Not introduced by this change.
- **Fix**: Track the "retry the dashboard plan load once on PGRST303" follow-up as its own small item (issue) instead of only an S-04 note.
- **Decision**: FIXED — tracked as issue #55 (M-1, bug, stream:D-ops)
