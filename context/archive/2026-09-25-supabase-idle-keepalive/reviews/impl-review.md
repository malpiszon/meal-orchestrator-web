<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Supabase Idle Keep-Alive Implementation Plan

- **Plan**: context/changes/supabase-idle-keepalive/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-09-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

- Local: `npm run lint` exits 0 (2 `no-console` warnings, see F1); `npx astro check` shows 0 errors, 0 warnings, 0 hints; `npm run build` succeeds; `dist/server/wrangler.json` contains `"triggers":{"crons":["0 3 * * *"]}`.
- CI run 36259759314 (master, #15): `keepalive cron succeeds -> 200` with `keepalive ok`, and the failure-mode step logs `keepalive failed: pingSupabase: Error: Network connection lost.` followed by `PASS keepalive cron reports failure -> 500`. `astro preview stop` really stops the first server (`Stopped preview server (pid 6048)`), so the failure-mode run hits the new preview.
- Every planned file (migration, `src/lib/keepalive.ts`, `src/worker.ts`, `wrangler.jsonc`, `scripts/smoke.mjs`, `ci.yml`, README, infrastructure/prd/roadmap) matches its contract. No unplanned code files changed.
- Manual items: 2.4 is correctly left unchecked because the first production cron run is due 2026-09-27 03:00 UTC. 2.5 is deferred by a user decision recorded in change.md.

## Findings

### F1 — Keep-alive logging trips `no-console` lint warnings

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/worker.ts:24, src/worker.ts:28
- **Detail**: The plan requires logging `keepalive ok` / `keepalive failed`, and Workers observability depends on these lines. The repo's ESLint config sets `no-console: warn` for `src/` and only turns it off for `scripts/**/*.mjs`, so `npm run lint` now reports 2 permanent warnings. Permanent warnings train people to ignore lint output.
- **Fix**: Add an ESLint override for `src/worker.ts` with `no-console: "off"` (the same approach `scriptsConfig` uses), or put `// eslint-disable-next-line no-console` on both lines.
- **Decision**: FIXED — added a `workerConfig` override in `eslint.config.js`; `npm run lint` now reports 0 warnings.

### F2 — README "Smoke test" section doesn't mention the keep-alive checks

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md (Smoke test section)
- **Detail**: The section still says the script walks "the whole auth flow (sign-up, sign-in, protected page, sign-out)". It now also fires `/cdn-cgi/handler/scheduled` and has a `KEEPALIVE_EXPECT_FAILURE=1` mode that CI uses. The plan's README contract only covered the Supabase Configuration and Deployment sections, so this is a small doc gap, not drift.
- **Fix**: Add one sentence noting the keep-alive cron step and the `KEEPALIVE_EXPECT_FAILURE=1` failure mode.
- **Decision**: FIXED — added a paragraph to the README's Smoke test section.

### F3 — Cron label is empty for locally triggered runs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/worker.ts:25
- **Detail**: CI logs show `keepalive ok ()`, because `/cdn-cgi/handler/scheduled` without `?cron=` passes an empty `controller.cron`. Production passes `0 3 * * *`, so this only affects how local and CI logs look.
- **Fix**: Leave it, or have smoke call `/cdn-cgi/handler/scheduled?cron=0+3+*+*+*` so the logs match production.
- **Decision**: FIXED — added a `KEEPALIVE_TRIGGER` constant with `?cron=0+3+*+*+*` in `scripts/smoke.mjs`, used by both keep-alive steps.

## Triage summary

- Fixed: F1, F2, F3 (3)
