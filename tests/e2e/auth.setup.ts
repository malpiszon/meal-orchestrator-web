import { test as setup } from "@playwright/test";
import { todayInWarsaw } from "@/lib/plans";
import { signIn } from "./support/auth";
import { deliverWeek, nextMonday } from "./support/deliveries";
import { ensureUserWithPassword } from "./support/users";

const authFile = "playwright/.auth/user.json";

setup("sign in once and save the session", async ({ page, request }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD (see context/foundation/test-stack.md, ## E2E)");
  }

  // Next week, so the session always has an upcoming week with radios. On a fresh stack the delivery creates
  // the account. A fixed run_id per week makes a re-run an identical body, which the app treats as a no-op.
  const weekStart = nextMonday(todayInWarsaw(new Date()));
  await deliverWeek(request, { email: username, weekStart, runId: `e2e-setup-${weekStart}` });
  await ensureUserWithPassword(username, password);

  await signIn(page, username, password);

  await page.context().storageState({ path: authFile });
});
