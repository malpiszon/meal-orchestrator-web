// Risk #4 (context/foundation/test-plan.md): the critical journey breaks in a real browser while the HTTP
// smoke stays green. One new user per run goes from MO's delivery and the invitation through keep picks,
// swap and rate to signing out and back in. It asserts only what needs a browser: hydrated islands, the
// optimistic save status, the rating toggles and the cookie session. The rules behind them (cut-off,
// rating window) are covered by pgTAP and the smoke test.
import { randomUUID } from "node:crypto";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { todayInWarsaw } from "@/lib/plans";
import { setPassword, signIn } from "./support/auth";
import { deliverWeek, nextMonday, thisMonday } from "./support/deliveries";
import { readInvitationLink } from "./support/mailpit";

// A new user, invited by email: start without the stored session of auth.setup.ts.
test.use({ storageState: { cookies: [], origins: [] } });

const SAVED_STATUS = /^Saved .+ · Editable until .+/;

/** The day card headed by `weekday` (e.g. "Monday") inside a week's tab panel. */
function dayCard(panel: Locator, weekday: string): Locator {
  return panel
    .locator('[data-slot="card"]')
    .filter({ has: panel.page().getByRole("heading", { name: new RegExp(`^${weekday}\\b`) }) });
}

/** Selects a week's tab; retried because the tabs are an island and a click before it hydrates is lost. */
async function openTab(page: Page, name: "This week" | "Next week"): Promise<void> {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click({ timeout: 2_000 });
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass();
}

test("a new user saves, swaps and rates meals, and finds them after signing in again (risk #4)", async ({
  page,
  request,
  baseURL,
}) => {
  // Mailpit polling (up to 15 s), two deliveries and a sign-out/sign-in cycle on a cold preview.
  test.slow();
  const email = `e2e-journey-${randomUUID()}@example.com`;
  const password = `e2e-${randomUUID()}`;
  const today = todayInWarsaw(new Date());

  await test.step("MO delivers this week and next week", async () => {
    // The first delivery creates the account and emails the invitation; a started week is stored too.
    await deliverWeek(request, { email, weekStart: thisMonday(today) });
    await deliverWeek(request, { email, weekStart: nextMonday(today) });
  });

  await test.step("the invitation link opens the set-password page", async () => {
    if (!baseURL) throw new Error("The e2e project needs a baseURL (playwright.config.ts)");
    await page.goto(await readInvitationLink(email, baseURL));
    await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
  });

  await test.step("setting a password lands on the dashboard", async () => {
    await setPassword(page, password);
    await expect(page.getByText("Something went wrong")).toBeHidden();
  });

  const nextWeek = page.getByRole("tabpanel", { name: "Next week" });
  const status = nextWeek.getByText(/Editable until/);

  await test.step("keeping the suggested picks saves next week", async () => {
    await openTab(page, "Next week");
    const keep = nextWeek.getByRole("button", { name: "Keep these picks" });
    // Retried until the editor has hydrated; the button disappears once the week is saved.
    await expect(async () => {
      if (await keep.isVisible()) await keep.click({ timeout: 2_000 });
      await expect(status).toHaveText(SAVED_STATUS, { timeout: 2_000 });
    }).toPass();
  });

  // The option swapped in on next week's Monday (a radio's value is its option id); known after the swap step.
  let optionId = "";
  const swappedRadio = () => nextWeek.locator(`input[type="radio"][value="${optionId}"]`);

  await test.step("swapping a meal saves it", async () => {
    const unchecked = dayCard(nextWeek, "Monday").getByRole("radio", { checked: false }).first();
    optionId = (await unchecked.getAttribute("value")) ?? "";
    expect(optionId, "the swapped-in option's id").not.toBe("");

    // Pinned by id: the "unchecked" locator above would move to another option once this one is checked.
    const radio = swappedRadio();
    await radio.check();
    await expect(radio).toBeChecked();
    // Saved again, not reverted: the swap's request has answered.
    await expect(status).toHaveText(SAVED_STATUS);
    await expect(radio).toBeChecked();
  });

  const thisWeek = page.getByRole("tabpanel", { name: "This week" });
  // Monday's first chosen meal: this week's Monday is always inside the rating window.
  const tasty = dayCard(thisWeek, "Monday")
    .getByRole("group", { name: /How was it\?/ })
    .first()
    .getByRole("button", { name: "Tasty" });

  await test.step("rating Monday's meal presses its face", async () => {
    await openTab(page, "This week");
    // Retried until the island has hydrated; a second click would clear the rating, so only click when unset.
    await expect(async () => {
      if ((await tasty.getAttribute("aria-pressed")) !== "true") await tasty.click({ timeout: 2_000 });
      await expect(tasty).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    }).toPass();
    // Not pending anymore and still pressed: the save answered without reverting.
    await expect(tasty).toHaveAttribute("aria-disabled", "false");
    await expect(tasty).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("signing out ends the session", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/auth/signin");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/signin$/);
  });

  await test.step("signing in again with the new password", async () => {
    await signIn(page, email, password);
  });

  await test.step("the saved swap and the rating are still there", async () => {
    await openTab(page, "Next week");
    await expect(swappedRadio()).toBeChecked();
    await expect(status).toHaveText(SAVED_STATUS);

    await openTab(page, "This week");
    await expect(tasty).toHaveAttribute("aria-pressed", "false");
  });
});
