# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.64.0
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/critical-journey.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4322
- port: 4322 (E2E_PORT from .env; detected default 4321 from the `astro preview` default, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT; reuseExistingServer outside CI
- auth setup project: setup (tests/e2e/auth.setup.ts), credentials from E2E_USERNAME / E2E_PASSWORD in .env (locally e.g. e2e-test@example.com); self-provisioning: it delivers next week for that user (creating the account on an empty stack) and sets the password through the Admin API before signing in, so it needs MO_INGEST_TOKEN, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY too
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects risk #4: the signed-in dashboard breaks in a real browser while the HTTP smoke stays green; runs on any date thanks to the self-provisioning setup
- journey: tests/e2e/critical-journey.spec.ts — risk #4 (and the invitation half of #7): a new user per run from delivery and the Mailpit invitation through keep picks, swap and rate to signing in again; no stored session
- helpers: tests/e2e/support/ (deliveries.ts, users.ts, mailpit.ts, auth.ts); see docs/testing.md#e2e
- mailpit: MAILPIT_URL in .env (optional, default http://127.0.0.1:54324); the invitation link is re-hosted on baseURL
- CI: `e2e` job in .github/workflows/ci.yml (own local Supabase, preview on 4321, test-only E2E_USERNAME e2e-ci@example.com / E2E_PASSWORD in the job env, 1 retry, report uploaded on failure); `deploy` needs it; required check on master
- browser CLI: playwright-cli (-s=mo-web; launch with `--browser chromium`), command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-11
