import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local secrets (E2E_USERNAME, E2E_PASSWORD, app env) come from the gitignored .env. The e2e helpers in
// tests/e2e/support also read MO_INGEST_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the optional MAILPIT_URL.
// In CI the job writes .env (app env and MAILPIT_URL) and sets E2E_USERNAME / E2E_PASSWORD in its env;
// loadEnvFile never overrides a variable that is already set.
if (existsSync(".env")) process.loadEnvFile(".env");

// 4321 is the `astro preview` default; E2E_PORT overrides it (4321 is where `astro dev` usually runs locally).
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  // The HTML report is what CI uploads on failure; `github` adds failure annotations to the PR.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["html", { open: "never" }]],
  use: {
    baseURL,
    // Traces record typed values, including passwords: keep test-only credentials wherever a report is shared.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Production-like build + preview on the Workers runtime, on the port above.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Astro 7 moves `astro preview` into a background daemon when it detects an agent; keep it in the foreground.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
