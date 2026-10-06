<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Expired Link Notice on Open

- **Plan**: context/changes/expired-link-notice/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan drift: every planned item MATCH. Documented extras only: the 2 s timeout (phase-2 review F1), the `no-console` allowance for `auth-links.ts` in `eslint.config.js`, and the `showsInvalidLinkNotice` smoke helper (pure refactor). "What We're NOT Doing" respected: no change under `src/pages/api/`, no verify on GET, no lifetime env var.

Success criteria re-run on 2026-10-06: `npx supabase test db` (49 assertions), `npm test` (119), `npm run lint` and `npx prettier --check README.md` pass; smoke on :4322 and CI (`ci`, `smoke`) on PR #71 passed at 5093811. Manual rows 3.4–3.6 confirmed by the user after the production rollout. Production also settled the hosted-privilege question: a dead link showed the notice and the Worker logs had no `auth link check` warnings, so `postgres` can read `auth.one_time_tokens` there.

## Findings

### F1 — A wrong "dead" answer locks users out silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/auth-links.ts:36, README.md:168
- **Detail**: Fail-open covers errors only. If a hosted Supabase Auth upgrade changes how it uses `auth.one_time_tokens` / `auth.users` but keeps the columns (renamed `token_type` value, expiry moved elsewhere), the function still runs and returns `false`, and every valid invite/reset link shows the notice instead of the form — with no log line, since `false` is not logged. pgTAP seeds its own rows and the smoke runs only on the local stack in CI, so neither sees a hosted-only Auth upgrade; the README sentence "The pgTAP test … and the smoke steps catch an upgrade that breaks it" overstates the guard for production.
- **Fix**: Log a token-free `console.info` when the check answers dead (e.g. `auth link check: link not live (type invite)`), and reword the README sentence to "catch a breaking change in the local Supabase version (CI); in production a sudden rise of `link not live` lines in the Worker logs is the signal".
  - Strength: Gives production a visible signal at the cost of one log line per dead-link open; README stops promising more than CI can deliver.
  - Tradeoff: A follow-up PR on already-merged code; a dead-link log is informational noise in normal operation.
  - Confidence: MED — the failure mode requires an Auth change upstream that keeps the schema; plausible but not imminent.
  - Blind spot: No alerting on Workers Logs exists, so the signal still depends on someone looking.
- **Decision**: FIXED — `console.info("auth link check: link not live (type …)")` on a dead answer, with a unit test; README now says pgTAP/smoke cover CI only and names the log line and the drop-function fail-open

### F2 — Production link lifetime is a hand-set duplicate

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/set-password.ts:34
- **Detail**: `AUTH_LINK_LIFETIME_SECONDS` must equal the production dashboard's Email OTP Expiration; the unit test pins only `config.toml`. A longer production value would make still-valid links show as expired. This is the plan's accepted design (README production step 2, verified at 3600 in 3.4).
- **Fix**: None needed; keep the README step. Revisit only if the dashboard value ever changes.
- **Decision**: SKIPPED — accepted as designed; README production step 2 covers it (confirmed 3600)

### F3 — Unbounded `token_hash` reaches the database on an anonymous GET

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/set-password.ts:17
- **Detail**: `tokenHashSchema` is `z.string().min(1)`, so any string up to Cloudflare's URL limit triggers one service-role RPC per page open. Cost is an indexed lookup, but it is unvalidated input on an unauthenticated path. GoTrue's token hashes are 56 lowercase hex characters.
- **Fix**: Add `.max(128)` to `tokenHashSchema` (keep the format loose so a GoTrue hash change can't reject real links), so junk is rejected before the round trip.
- **Decision**: FIXED — `tokenHashSchema` capped at `TOKEN_HASH_MAX_LENGTH = 128`, with a unit test
