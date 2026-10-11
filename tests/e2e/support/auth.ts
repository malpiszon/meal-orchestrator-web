// Signing in through the real sign-in form.
import { expect, type Page } from "@playwright/test";

/** Signs in on `/auth/signin` with `email` and `password` and waits for the dashboard. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/signin");
  // The form is a React island: input typed before it hydrates is lost. Retry fill + submit until the
  // submit leaves the sign-in page. Clear before filling so a controlled input sees a change event.
  await expect(async () => {
    await page.getByLabel("Email").fill("");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();
  await expect(page.getByRole("heading", { name: "Your meals" })).toBeVisible();
}
