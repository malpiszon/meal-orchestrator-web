<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Critical-journey e2e as a CI gate (S-04)

- **Plan**: context/changes/testing-critical-journey-e2e/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated criteria re-run on 2026-10-11: `npm run lint` (0 errors), `npx astro check` (0 errors), `npm test` (207 passed), `npx playwright test` twice in a row (3 passed each), PR #134 checks `ci`/`smoke`/`e2e` green. Manual rows 1.6, 2.5, 2.6, 3.5–3.7 were confirmed by the user in session; 3.6 has evidence in CI runs 38148769953 (broken commit ff5064a, e2e red, report with traces) and the green revert a904feb. `e2e` in master's required checks (3.5) was set by the user; this token gets 403 on branch protection, so the review could not read it back.

## Findings

### F1 — e2e helpers run the service-role key against any SUPABASE_URL

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/support/users.ts:17-24, playwright.config.ts:10
- **Detail**: `playwright.config.ts` loads `.env` locally, and the helpers use `SUPABASE_SERVICE_ROLE_KEY` against whatever `SUPABASE_URL` it holds. With a `.env` pointed at the hosted project, `npm run test:e2e` would reset `E2E_USERNAME`'s password there through the Admin API, and the journey would create an `e2e-journey-<uuid>@example.com` account with two weeks on every run and send real invitation emails (bouncing, eating the hosted 2/h email budget). Migration replay guards its destructive step with an explicit opt-in (`MIGRATION_REPLAY_WIPES_LOCAL_DB`); the e2e has no guard.
- **Fix**: In `playwright.config.ts`, after loading `.env`, throw unless `SUPABASE_URL`'s host is `127.0.0.1` or `localhost`; mention it in docs/testing.md E2E.
  - Strength: One check covers the setup, the journey and the preview the helpers deliver to; mirrors the replay's guard.
  - Tradeoff: Running the e2e against a remote stack would need the guard edited (no such use today).
  - Confidence: HIGH — CI and the documented local flow both use 127.0.0.1.
  - Blind spot: None significant.
- **Decision**: FIXED — localhost/127.0.0.1 guard on SUPABASE_URL in playwright.config.ts; docs/testing.md E2E note

### F2 — First e2e CI duration not recorded in test-plan §6.5

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md §6.5 (Phase 4 note)
- **Detail**: Plan "Performance Considerations" says to record the first run's duration in §6.5; the note still says it is "to be recorded here after its first CI runs". Run 38149300711: `e2e` 2m13s, `smoke` 3m09s, started together, so e2e adds no wall-clock time per PR.
- **Fix**: Replace the sentence with the measured durations (e2e ~2m15s, finishes before smoke ~3m10s; no added wall-clock time).
- **Decision**: FIXED — §6.5 records e2e ~2m15s beside smoke ~3m10s, no added wall-clock time

### F3 — Invitation-link regex depends on query order

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/support/mailpit.ts:16
- **Detail**: `/\/auth\/set-password\?[^\s"<>]*type=invite/` ends at `type=invite`, which works only because `supabase/templates/invite.html:5` puts it last. Reordered params would silently drop `token_hash` and fail later on the set-password page. Smoke captures the whole href and parses it as a URL.
- **Fix**: Capture the full href as smoke does, parse it with `URL`, and require `type=invite` and a `token_hash`.
- **Decision**: FIXED — mailpit.ts captures the full set-password path and checks type=invite and token_hash by name

### F4 — Traces also hold the MO_INGEST_TOKEN bearer header

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: docs/testing.md (E2E, trace note), playwright.config.ts:24-25
- **Detail**: `deliverWeek` uses Playwright's `request` fixture, whose calls (headers included) go into traces, so a failure trace carries `Authorization: Bearer <MO_INGEST_TOKEN>`. CI's value is test-only; a shared local report would carry the developer's `.env` token. The note only mentions passwords.
- **Fix**: Add "and the `MO_INGEST_TOKEN` bearer header" to the trace note in docs/testing.md and the config comment.
- **Decision**: FIXED — trace note in docs/testing.md and playwright.config.ts mentions request headers / MO_INGEST_TOKEN

### F5 — Stale seed comment

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/seed.spec.ts:3
- **Detail**: "swap, save and rate are for later specs" — they now live in `critical-journey.spec.ts` (plan allowed seed comment edits).
- **Fix**: Point the comment at `critical-journey.spec.ts`.
- **Decision**: FIXED — seed comment points at critical-journey.spec.ts

### F6 — test-stack.md references a gitignored skill file

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-stack.md ("browser CLI" line)
- **Detail**: Points at `.claude/skills/playwright-cli/SKILL.md`, which `.gitignore:40` (`.claude/*`) excludes, so a fresh clone lacks it.
- **Fix**: Mark it local-only ("installed per checkout, gitignored").
- **Decision**: FIXED — test-stack.md marks the playwright-cli skill as local to each checkout

### F7 — Flaky passes don't upload their traces

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml (e2e upload step, `if: failure()`)
- **Detail**: With `retries: 1`, a test that fails then passes on retry exits 0; its retained trace is not uploaded, so flakiness is visible only as a "flaky" line in the log. Matches the plan ("on failure upload").
- **Fix**: Optional: `if: ${{ !cancelled() }}` with `if-no-files-found: ignore`, so flaky runs keep their traces.
- **Decision**: FIXED — upload runs when not cancelled and a trace.zip exists (failure or flaky pass); docs CI bullet updated

### F8 — A run crossing Sunday midnight in Warsaw can flake once

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/critical-journey.spec.ts:42, tests/e2e/auth.setup.ts:18
- **Detail**: `today` is computed once per test; if the run crosses 00:00 Warsaw Sunday→Monday, "next week" has started by the time the dashboard renders and the swap hits the cut-off. The CI retry recomputes `today` and covers it.
- **Fix**: Accept; optionally a one-line comment at the `today` computation.
- **Decision**: FIXED — comment at the journey's today computation
