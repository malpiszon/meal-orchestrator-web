// Risk #4 (context/foundation/test-plan.md): the critical journey breaks in a real browser while the HTTP
// smoke stays green, e.g. the dashboard shows "Something went wrong". This seed covers the signed-in
// dashboard render; save, swap and rate are in critical-journey.spec.ts.
import { test, expect } from "@playwright/test";

test("signed-in dashboard renders the delivered week and survives a reload (risk #4)", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Your meals" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Next week" })).toBeVisible();
  await expect(page.getByRole("radio").first()).toBeVisible();
  await expect(page.getByText("Something went wrong")).toBeHidden();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your meals" })).toBeVisible();
  await expect(page.getByRole("radio").first()).toBeVisible();

  // Read-only: nothing to clean up. Not signing out, as that would revoke the session other specs load.
});
