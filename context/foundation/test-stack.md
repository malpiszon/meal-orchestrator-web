# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.64.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/seed.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4322
- port: 4322 (E2E_PORT from .env; detected default 4321 from the `astro preview` default, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT; reuseExistingServer outside CI
- auth setup project: setup (tests/e2e/auth.setup.ts), credentials from E2E_USERNAME / E2E_PASSWORD in .env (local Supabase test user e2e-test@example.com, created by an MO delivery plus an admin-API password; see docs/dev-walkthrough.md)
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects risk #4: the signed-in dashboard breaks in a real browser while the HTTP smoke stays green
- browser CLI: playwright-cli (-s=mo-web; launch with `--browser chromium`), command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-11
