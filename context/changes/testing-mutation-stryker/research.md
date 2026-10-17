---
date: 2026-10-17T15:25:55+02:00
researcher: Claude (Opus 5.5) for alan
git_commit: 7e76829e2df17fc22654194aa3ba3c2b91a8d5d2
branch: testing-mutation-stryker
repository: malpiszon/meal-orchestrator-web
topic: "Can Stryker mutation-test src/lib/ with this repo's Vitest 5 and TypeScript 6, and is a run fast enough for CI?"
tags: [research, testing, mutation, stryker, vitest, src-lib, ci]
status: partial
last_updated: 2026-10-17
last_updated_by: Claude (Opus 5.5)
---

# Research: Stryker mutation testing over `src/lib/`

**Date**: 2026-10-17T15:25:55+02:00
**Researcher**: Claude (Opus 5.5) for alan
**Git Commit**: 7e76829e2df17fc22654194aa3ba3c2b91a8d5d2
**Branch**: testing-mutation-stryker
**Repository**: malpiszon/meal-orchestrator-web

## Research Question

From S-06 (issue #124, `context/foundation/roadmap.md:163,171`): a developer can run mutation testing over `src/lib/` and see which code changes the unit tests fail to catch. Open unknown: does Stryker work with this repo's Vitest and TypeScript versions, and is a run fast enough for CI or only for local use?

## Summary

- **Installable: yes.** As of 2026-10-17 the latest StrykerJS is 10.0.0 (core, vitest-runner, typescript-checker; published 2026-08-14). The peer ranges are `vitest >=2.0.0` and `typescript >=3.6`, and `engines.node` is `>=22`. The repo has vitest 5.0.4, typescript 6.0.3 and Node 22.23.3, so all of these fit. Checked with `npm view`; not installed into the repo.
- **Usable as shipped: no.** Upstream issue stryker-js#6210 is open: on Vitest 5 the runner's per-test name filter matches no test, so every covered mutant is reported Survived. The published 10.0.0 runner joins suite and test names with a space (`dist/src/test-helpers.js:11`, `dist/src/stryker-setup.js:66`, read from the npm tarball). Vitest 5.0.4 builds full test names with `" > "` (`node_modules/vitest/dist/chunks/index.uwTEEBsB.js:7732,8482`). The fix PRs #6214 and #6247 are open and unmerged. No runner release has shipped since 10.0.0.
- **Workarounds:**
  - (a) Patch both runner files to join with `" > "` (patch-package). Several issue reporters confirm this works; it was not run here.
  - (b) `testRunner: "command"`, which runs the whole suite for every mutant.
  - (c) Wait for a fixed release, or park S-06. The roadmap already names it "first to park" (`roadmap.md:172`).
- **Second repo-specific issue:** the runner forces `pool: 'threads'` (`dist/src/vitest-test-runner.js:51`). Upstream #5982 (open) says this makes `test.env.TZ` ineffective. This repo sets `TZ: "Pacific/Honolulu"` (`vitest.config.ts:12`), and `src/lib/plans.test.ts:267` asserts it. Stryker therefore needs `TZ` set in the process environment.
- **Fast enough for CI: unanswered.** No Stryker run or timing was taken: the S-03 worktree had a preview running (CLAUDE.local.md forbids timings then), and installing the dependency is implementation. Only the baseline was taken: 22 test files and 424 tests pass in 8.45 s under that load. The end-of-turn hook states ~3 s for the same suite (`.claude/hooks/end-of-turn.sh:122`). Whether a run fits CI must be measured in the plan's first phase.

## Detailed Findings

### Stryker versions and compatibility

- Versions: core, vitest-runner and typescript-checker are all 10.0.0, `latest` dist-tag, published 2026-08-14. Previous: 9.6.1 (2026-04-10). 10.0.0 dropped Node 20 and added experimental TS 7 support to the checker (release notes v10.0.0).
- Peer ranges: vitest-runner `{"vitest": ">=2.0.0", "@stryker-mutator/core": "10.0.0"}`; typescript-checker `{"typescript": ">=3.6", …}`. No `--legacy-peer-deps` or overrides are needed for the installed vitest 5.0.4 and typescript 6.0.3.
- Name-filter bug (#6210, open, updated 2026-10-14):
  - Reporters reproduced it on vitest 5.0.0–5.0.4 with runners 9.6.1 and 10.0.0. One reporter's example: vitest 4.1.11 gave 33 killed / 3 survived, vitest 5.0.0 gave 3 / 33.
  - The suggested patch must touch both files; reporters say patching one turns every mutant into NoCoverage:
    ```diff
    -    return nameParts.join(' ').trim();
    +    return nameParts.filter((part) => part !== '').join(' > ').trim();
    ```
  - Locally I confirmed only the two halves of the mismatch (the runner's `join(' ')` and Vitest's `join(" > ")`), not the bug end to end.
- Other open upstream issues that would distort a score (reported by the compatibility worker from the issue tracker; not reproduced):
  - #6248 / PR #6246: the name regex has no end anchor, so the test "calc add" also selects "calc add negative".
  - #6256: unreached mutants are shown as Survived instead of NoCoverage.
  - #6234, #6150: a throwing `beforeAll`, or a file that collects no tests, is reported Survived.
  - #6073: verdicts are non-deterministic under perTest on vitest 4.1.9.
  - On Vitest 5, `logLevel: "debug"` crashes with a circular JSON error.
- TypeScript checker: the `>=3.6` peer accepts TS 6. It type-checks with the project's tsconfig, and `tsconfig.json:3` includes `**/*` plus `.astro/types.d.ts`, so each check covers the whole project and needs `astro sync` output in the sandbox. It only marks mutants that don't compile, and it is optional.

### How the vitest runner treats this repo's config

Source: stryker-mutator.io/docs/stryker-js/vitest-runner and the published dist.

- It loads `vitest.config.ts`, so the `@` alias (`vitest.config.ts:10-11`) and `include` (`:9`) apply. `vitest.related` defaults to true.
- `coverageAnalysis` is always perTest.
- It forces `pool: 'threads'` with one worker per Stryker process, plus bail, coverage off and watch off (`vitest-test-runner.js:36-53`). With the threads pool, `test.env.TZ` (`vitest.config.ts:12`) doesn't change the timezone (#5982), and `plans.test.ts:267` (`getTimezoneOffset()` is 600) would fail the dry run. Fix: `TZ=Pacific/Honolulu` in the Stryker npm script or CI env.
- `vitest.config.ts:9` also includes `scripts/**/*.test.ts`. Today that is only `scripts/__tests__/agent-hooks.test.ts`, 498 lines and 27 tests. It spawns real `bash`, `git` and `jq` in temp repos and opens localhost ports. It reads `.claude/hooks` from the checkout (`:13-14`), which is gitignored except `settings.json` and `hooks/` (`.gitignore`). It covers no `src/lib` code, so it adds dry-run time and side effects only. A Stryker-only vitest config, or `vitest.dir: "src"`, would leave it out.
- `vi.mock` is used in 6 test files: 5 mock `@sentry/cloudflare`, and `services/mo-deliveries.test.ts:7` mocks `@/lib/report-handled-error`. The docs list no limitation for it. That it works in the sandbox is inferred, not tested.

### `src/lib/` mutate scope

28 non-test files: 23 in `src/lib/`, 5 in `src/lib/services/`.

- **No sibling test, and no unit test can load them** (they import `astro:env/server` directly or through `supabase.ts`, which Vitest can't resolve). Every mutant in them would be NoCoverage, so they belong in `mutate` exclusions:
  - `config-status.ts`, `supabase.ts` (import `astro:env/server` at `:1`, `:4`)
  - `json-request.ts`, `plan-save.ts` (import `@/lib/supabase`)
- **No sibling test, other reasons:**
  - `keepalive.ts`: only `src/worker.ts` uses it, and only the CI keepalive smoke covers it.
  - `utils.ts`: the 6-line `cn()` helper.
- **No sibling test, but reached indirectly:** `password-rules.ts`, through `set-password.ts:2` and `set-password.test.ts`.
- The other 21 files have a sibling `.test.ts`. The largest are `plans.ts` (228 lines), `services/plans.ts` (225), `services/mo-deliveries.ts` (208), `mo-delivery.ts` (169) and `set-password.ts` (134).

### Test traits that affect mutation results

- **Real-timer retries:**
  - `withPgrst303Retry` waits 500 ms and 1500 ms with a real `setTimeout` (`src/lib/postgrest-retry.ts:7,40`).
  - `services/ratings.test.ts` uses no fake timers, and most of `services/plans.test.ts` runs on real timers (fake timers only at `:110-138`).
  - So a mutant that makes `isJwtIssuedAtFuture` true or skips the `!result.error` check (`postgrest-retry.ts:18-20,36`) adds up to 2 s per call. Stryker's default timeout (5000 ms + 1.5 × baseline) may then score it Timeout, which counts as killed, or slow the run.
- **Filesystem read:** `set-password.test.ts:191` reads `supabase/config.toml`. The sandbox copies it unless `ignorePatterns` drops it.
- **Fake throws on unknown methods:** `src/test/fake-supabase.ts` throws on any PostgREST builder method it doesn't implement (`docs/testing.md`; `context/foundation/test-plan.md` §6.1). A mutant that switches a call to an unimplemented method (e.g. `gt` → `gte`) is killed by the throw, not by a behaviour assertion. S-01's review recorded exactly this for its manual mutation (`context/archive/2026-10-10-testing-migration-date-rules/reviews/impl-review-phase-2.md:36-43`). Such kills overstate the score for `services/plans.ts`.

### Tooling interactions with `.stryker-tmp/` and `reports/`

Neither directory is in `.gitignore` today, and the repo has no `.prettierignore`.

- **ESLint:** it takes its ignores only from `.gitignore` (`eslint.config.js`: `includeIgnoreFile(gitignorePath)`), so `npm run lint` would type-check-lint sandbox copies.
- **TypeScript:** `tsconfig.json:3-4` includes `**/*` and excludes only `dist`, so `astro check` would check them too.
- **Prettier 3** honours `.gitignore`.
- **End-of-turn hook:** `.claude/hooks/end-of-turn.sh` collects untracked files with `git ls-files -o --exclude-standard` (`:72`) and fingerprints them (`:76`). An un-gitignored sandbox would flood its ESLint list and fingerprint.
- **Per-edit hook:** `.claude/hooks/related-tests.sh` matches only `src/lib/*` and `src/test/*` from the git root (`:53-60`), so sandbox paths don't trigger it.
- Adding both directories to `.gitignore` covers ESLint, Prettier and the hook. `tsconfig.json` `exclude` needs them as well.

### CI context

`.github/workflows/ci.yml` has these jobs:

| Job       | Line   | What it runs                                  |
| --------- | ------ | --------------------------------------------- |
| `ci`      | `:18`  | lint, unit, `astro check`, build, bundle size |
| `changes` | `:45`  | detects docs-only PRs                         |
| `smoke`   | `:67`  | pgTAP, smoke, replay                          |
| `e2e`     | `:125` | Playwright                                    |
| `deploy`  | `:173` | needs `ci`, `smoke` and `e2e`                 |

- The e2e job takes about 2 min 15 s beside smoke at about 3 min 10 s (`test-plan.md` §6.5 Phase 4, measured 2026-10-11). A mutation job in parallel stays off the critical path if it runs in under about 3 min.
- Stryker's incremental mode (`--incremental`, file `reports/stryker-incremental.json`) could be cached between CI runs. It doesn't detect changes outside mutated and test files. StrykerJS has no git-diff ("since") mode; `--mutate file:lines` and the new mutant filtering (#6010) are the nearest options.
- `thresholds.break` makes a run exit non-zero below a score. Whether to gate on it is a plan or product choice.

## Code References

- `vitest.config.ts:9` – `include` with `scripts/**/*.test.ts`
- `vitest.config.ts:12` – `env: { TZ: "Pacific/Honolulu" }`
- `src/lib/plans.test.ts:267` – asserts the Honolulu offset
- `src/lib/postgrest-retry.ts:7,36-40` – real-timer retry delays
- `src/lib/set-password.test.ts:191` – reads `supabase/config.toml`
- `src/lib/config-status.ts:1`, `src/lib/supabase.ts:4` – `astro:env/server` imports (untestable in Vitest)
- `src/test/fake-supabase.ts:150` – `fakeSupabase`, throws on unimplemented builder methods
- `scripts/__tests__/agent-hooks.test.ts:13-14,75,139,489` – reads `.claude/hooks`, spawns bash, git and jq
- `tsconfig.json:3-4` – `include: [".astro/types.d.ts", "**/*"]`, `exclude: ["dist"]`
- `eslint.config.js` – ignores come from `.gitignore`
- `.claude/hooks/end-of-turn.sh:72,76,90-91,122` – untracked-file sweep, fingerprint, CODE trigger, unit suite
- `.claude/hooks/related-tests.sh:53-60` – per-edit path match
- `.github/workflows/ci.yml:18,45,67,125,173` – CI jobs
- `@stryker-mutator/vitest-runner@10.0.0` `dist/src/test-helpers.js:11`, `dist/src/stryker-setup.js:66` – `nameParts.join(' ')`
- `@stryker-mutator/vitest-runner@10.0.0` `dist/src/vitest-test-runner.js:51` – forced `pool: 'threads'`
- `node_modules/vitest/dist/chunks/index.uwTEEBsB.js:7732,8482` – Vitest 5.0.4 joins names with `" > "`

## Architecture Insights

- Stryker scores only TypeScript. SQL plan logic keeps S-01's manual mutation checks (`roadmap.md:172`).
- The useful mutate set is the 21 files with sibling tests plus `password-rules.ts`. The `astro:env` files are untestable in Vitest by design: their logic moved out to testable helpers, e.g. `handleMoDelivery` (`test-plan.md` §6.5 Phase 2).
- Test expectations must come from independent sources, never from the implementation (`test-plan.md` §1). Surviving mutants are therefore prompts to add assertions taken from the PRD or docs, not to mirror the code.

## Historical Context (from prior changes)

- `context/archive/2026-10-10-testing-migration-date-rules/plan.md:217,412`: S-01 did manual TS mutations, flipping `getUpcomingPlan`'s order to `ascending: false` and `getCurrentPlan`'s `gt` to `gte`. Supported: these are the hand checks S-06 is meant to automate (`roadmap.md:163`).
- `context/archive/2026-10-10-testing-migration-date-rules/change.md:16` and `reviews/impl-review-phase-2.md:32,36-43`:
  - The `gte` mutant was "caught by the fake's throw, not by behaviour", so the manual check used an equivalent `gt(addDays(today,-8))`.
  - Deleting `.order(...)` is only half-protected by fixture order.
  - Supported, and it predicts spurious kills under Stryker (see Test traits).
- `context/archive/2026-10-10-testing-migration-date-rules/reviews/plan-review.md:94-101`: the mutation steps were moved to Manual verification.
- `roadmap.md:36`: the user asked for mutation testing as a nice-to-have on 2026-10-10 ("cover only risks listed there + nice to have for mutation tests"). `test-plan.md` §3 and §5 have no mutation phase or gate. The S-06 issue's Definition of done requires §4 Stack to be updated, and §3 only if it becomes a phase.

## Related Research

- `context/archive/2026-10-10-testing-migration-date-rules/` (manual mutation checks; no separate mutation research exists).

## Open Questions

1. **Which way around #6210** (product/plan choice): patch-package both runner files, use the command runner, or wait for a release (and park S-06 if none ships). Recheck `npm view @stryker-mutator/vitest-runner version` and PRs #6214/#6247 before implementing.
2. **Run time** (gap, needs measurement): one full run over the mutate set, timed when no other worktree runs a preview, smoke or e2e. Then decide CI (job beside `smoke`, incremental cache, `break` threshold or report only) or local only.
3. **Typescript checker:** worth the slowdown given the whole-project tsconfig, or skip it (`disableTypeChecks` default true)?
4. **Spurious kills:** whether to accept kills caused by the fake's "not implemented" throw and by Timeout on retry mutants, or tune them (`timeoutMS`, or `// Stryker disable` on the retry delays).
5. **Docs placement:** `docs/testing.md`, `test-plan.md` §4 and the README scripts table must wait until S-03 merges (CLAUDE.local.md).
