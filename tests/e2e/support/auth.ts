// Signing in and setting a password through the real auth forms.
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Waits until the React island holding `field` has hydrated: Astro removes the island's `ssr` attribute then.
 * Input typed before that is lost, and the forms are native POSTs, so waiting once beats retrying a submit
 * (a set-password retry would re-send a one-time link that the first submit already used).
 */
async function waitForHydration(page: Page, field: Locator): Promise<void> {
  await expect(page.locator("astro-island", { has: field })).not.toHaveAttribute("ssr");
}

/** Signs in on `/auth/signin` with `email` and `password` and waits for the dashboard. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/signin");
  const emailField = page.getByLabel("Email");
  await waitForHydration(page, emailField);
  await emailField.fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"));
  await expect(page.getByRole("heading", { name: "Your meals" })).toBeVisible();
}

/** On the set-password page an invitation link opened, sets `password` and waits for the dashboard. */
export async function setPassword(page: Page, password: string): Promise<void> {
  const passwordField = page.getByLabel("New password", { exact: true });
  await waitForHydration(page, passwordField);
  await passwordField.fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/set-password"));
  await expect(page.getByRole("heading", { name: "Your meals" })).toBeVisible();
}
