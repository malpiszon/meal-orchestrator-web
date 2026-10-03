<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Email-link Callback Implementation Plan

- **Plan**: context/changes/email-link-callback/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: diff `f61f914..2ddf414`. Every planned change in all three phases is a MATCH: route, schema and tests, templates, `config.toml`, smoke steps, CI wiring, README sections, infrastructure note, and the F-01-only roadmap edit. No item from the "What We're NOT Doing" list was violated. Gates were re-run on HEAD:

- `npm test`: 54/54
- `npm run lint`: 0 problems
- `npx astro check`: 0 errors
- `npm run build`: ok
- `prettier --check` on the three docs: clean
- PR #45 and PR #46: `ci` and `smoke` green

All manual rows are confirmed by the user. That includes 3.3: the production invite landed on `/dashboard`, and the reused link was rejected.

Not findings (post-merge bookkeeping for `/10x-roadmap`):

- F-01 is still `in-progress` at `roadmap.md` L44/L93.
- F-01's Backlog Handoff row (L242) still says to run `/10x-plan`.

The dashboard's "Couldn't load your plan" error seen during 3.3 is outside this change. The user set it aside for the upcoming E2E work.

## Findings

### F1 — Login CSRF through the GET confirm route is missing from the handoff

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/confirm.ts:24
- **Detail**: `verifyOtp` runs on the GET that opens the link. An attacker can generate a recovery link for their own account and make a victim open it, either as a link or through a top-level redirect (`SameSite=Lax` doesn't block those). The victim is then silently signed in as the attacker, and their current session is replaced. The impact is low today, because the victim would only see the attacker's plan. It grows once users can save data (S-03 and later), since that data would land in the attacker's account. The fix is the same as for the known mail-scanner issue: an interstitial page whose button POSTs before `verifyOtp`. But the handoff to S-04/S-05 (roadmap F-01 block, comments on #8/#5) names only the scanner reason.
- **Fix**: Add login CSRF as a second reason in the F-01 handoff line in `roadmap.md`, and post a short follow-up comment on #8 and #5.
- **Decision**: FIXED — login CSRF added to the F-01 handoff line in roadmap.md and posted as an addendum comment on #8 and #5

### F2 — Unplanned `eslint.config.js` change

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:82
- **Detail**: Commit 8270058 adds `src/pages/api/auth/confirm.ts` to the `no-console` exemption. The plan doesn't mention this. It is benign: it follows the existing Workers Logs pattern, and it clears the 2 warning annotations on the #45 merge run that Phase 1's logging introduced. It is described in PR #46.
- **Fix**: None needed. Accept it as a documented follow-up.
- **Decision**: ACCEPTED — documented follow-up in PR #46

### F3 — Stale `additional_redirect_urls` in local config

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/config.toml:156
- **Detail**: `site_url` moved to `http://localhost:4321`, but `additional_redirect_urls` still lists the template's `https://127.0.0.1:3000`. The plan deliberately left it as is, because token_hash links don't use `redirect_to`. Nothing breaks.
- **Fix**: Optional. Set it to `["http://localhost:4321"]` when S-04/S-05 next touch `config.toml` (it needs a Supabase restart anyway).
- **Decision**: FIXED — `additional_redirect_urls = ["http://localhost:4321"]` (applies on the next local Supabase restart)

### F4 — Malformed link queries logged as errors

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/confirm.ts:20
- **Detail**: Every bot or scanner that hits `/api/auth/confirm` without valid parameters produces a `console.error` in Workers Logs, which adds noise to real failures.
- **Fix**: Log the malformed-query case with `console.warn`, and keep `console.error` for `verifyOtp` failures.
- **Decision**: FIXED — malformed-query case logs with `console.warn`; `verifyOtp` failures stay `console.error`
