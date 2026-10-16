# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Capture full pgTAP output on the shared local stack

- **Context**: supabase/tests/ — `npx supabase test db` run from a worktree against the local Supabase stack shared with other worktrees
- **Problem**: 1 of 14 runs failed with its output cut off (piped through `tail`), and 13 reruns passed, so the failing file and the cause (likely another worktree's tests or smoke running concurrently; test files use fixed user UUIDs) could not be found.
- **Rule**: Run `npx supabase test db` with its full output saved to a log file, never piped through `tail`/`grep` alone. On an unexpected FAIL on the shared stack, read the log before rerunning, and rerun alone before debugging.
- **Applies to**: /10x-implement and /10x-impl-review gates that run pgTAP or the smoke against the shared local Supabase

## Stop stale previews before running e2e locally

- **Context**: playwright.config.ts:49 — `reuseExistingServer` is on outside CI, so `npm run test:e2e` reuses whatever already listens on `E2E_PORT`
- **Problem**: A preview left running on 4325 kept serving after a rebuild replaced `dist/`, so its page scripts answered 500 and no React island became interactive. `auth.setup` then timed out waiting for the sign-in form, which looked like a flaky test.
- **Rule**: Before `npm run test:e2e`, check that nothing listens on `E2E_PORT` (or stop the preview you started for a manual check). A hydration timeout in `auth.setup` means "check the reused server" (curl an `/_astro/*` asset) before rerunning or debugging the test.
- **Applies to**: /10x-implement, /10x-impl-review and /10x-e2e gates that run Playwright locally
