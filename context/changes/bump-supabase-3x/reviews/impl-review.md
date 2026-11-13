<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Supabase CLI 2.x → 3.x Bump

- **Plan**: context/changes/bump-supabase-3x/plan.md
- **Scope**: Full plan (Phase 2 row 2.10 is post-merge and pending)
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Notes: the branch diff (origin/master...HEAD) touches exactly the 10 planned files plus the change folder; no unplanned files. Phase 2 has no file changes: README:46 was left unchanged because the running PostgREST v14.5, gotrue v2.197.0 and postgres 17.6.1.166 match `supabase/.temp/*-version`. `--local`, `inbucket` and an unqualified `db push` remain only in `context/` (planning docs and `test-plan.md:163`, kept on purpose). Re-run on the current tree: `supabase --version` 3.1.0, the plan's grep finds nothing, the hook's listing pipeline exits 0 with an empty line, `npm test` 22 files / 428 tests, `npm run lint` clean. Gates 2.1–2.5 (start, pgTAP 317 tests, `migration up`, smoke 147 steps) ran earlier in this session; PR #215's CI (`ci`, `smoke`, `e2e`) is green. Manual 2.7–2.9 confirmed by the user; 2.10 (#211 closed) pending until after merge.

## Findings

### F1 — PR body misses the queued "run `npm install` after pulling" note

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: PR #215 body; context/changes/bump-supabase-3x/follow-ups/review-fixes.md:3
- **Detail**: The Phase 1 review's F1 was triaged as "queued for the Phase 2 PR body", but the body of #215 never mentions `npm install`, and the follow-up is still unticked. Any other worktree or checkout that pulls master after the merge while keeping a v2 `node_modules` would run the hook's `migration list` (no `--local`) against the linked production project. That's read-only, but it lists the wrong pending migrations.
- **Fix**: Add a "After pulling: run `npm install`" line to the PR body (via `gh api` PATCH) and tick the follow-up.
- **Decision**: FIXED — note added to PR #215 body; follow-up ticked

### F2 — `npm run preview` stalls when an agent runs it (Astro auto-background)

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: plan.md Phase 2 smoke criterion; playwright.config.ts:46
- **Detail**: Astro 7 detects an agent and runs `astro preview` in the background, waiting 30 s for a lock file. Here it failed twice with "Preview server failed to start within 30s." and an empty `.astro/preview.log`; with `--ignore-lock` (foreground) it answered within a second. Not caused by the CLI bump, but it affects every agent-run smoke gate, and probably Playwright's `webServer` (`npm run preview -- --port ${PORT}`) when an agent runs `npm run test:e2e` locally. CI is unaffected (no agent detected).
- **Fix**: Record a lesson: when an agent starts a preview, pass `--ignore-lock` and run it as its own background task. Check Playwright's `webServer` separately, outside this change.
  - Strength: The next agent-run gate doesn't lose time on the same stall; the change stays scoped.
  - Tradeoff: It works around the stall without finding why the backgrounded child never wrote its lock file.
  - Confidence: MED — reproduced twice in this session; root cause not investigated.
  - Blind spot: Haven't confirmed that the Playwright webServer path actually hits the auto-background.
- **Decision**: FIXED differently — root cause found: on a slow local filesystem, loading the config's dependencies takes ~31–33 s on every start (`@astrojs/cloudflare` 14 s, `astro/config` 9 s, `@sentry/astro` 7 s), past the 30 s deadline Astro gives an agent-backgrounded preview. Playwright was already safe (`ASTRO_PREVIEW_BACKGROUND: "1"`, playwright.config.ts:53). Fix: `"preview": "ASTRO_PREVIEW_BACKGROUND=1 astro preview"` in package.json, so `npm run preview` stays in the foreground for agents too; verified up after 35 s with no timeout. Side effect: the lock file marks the server as background (`astro preview status`/`logs` labels only). No lesson needed.
