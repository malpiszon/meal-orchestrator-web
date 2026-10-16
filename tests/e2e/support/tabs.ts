// Selecting a week's tab on the dashboard.
import { expect, type Page } from "@playwright/test";

/** Selects a week's tab; retried because the tabs are an island and a click before it hydrates is lost. */
export async function openTab(page: Page, name: "This week" | "Next week"): Promise<void> {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click({ timeout: 2_000 });
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass();
}
