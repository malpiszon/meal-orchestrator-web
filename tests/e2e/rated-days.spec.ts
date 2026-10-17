// Roadmap risk of collapse-fully-rated-days: a fully rated day on "This week" collapses to one line, and the
// collapse must not get in the way of rating. One new user per run (so an earlier run's ratings can't leave
// Monday collapsed from the start) rates both of Monday's meals; after a reload Monday is one closed line whose
// summary is a keyboard control and still a heading, and inside the reopened day a rating still changes and
// clears. Which days collapse (any rating, chosen meals only) is unit-tested in src/lib/ratings.test.ts.
import { randomUUID } from "node:crypto";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { todayInWarsaw } from "@/lib/plans";
import { signIn } from "./support/auth";
import { deliverWeek, thisMonday } from "./support/deliveries";
import { openTab } from "./support/tabs";
import { ensureUserWithPassword } from "./support/users";

// A new user: start without the stored session of auth.setup.ts.
test.use({ storageState: { cookies: [], origins: [] } });

/** The day card headed by `weekday` (e.g. "Monday") inside a week's tab panel. */
function dayCard(panel: Locator, weekday: string): Locator {
  return panel
    .locator('[data-slot="card"]')
    .filter({ has: panel.page().getByRole("heading", { name: new RegExp(`^${weekday}\\b`) }) });
}

/** The "How was it?" groups of a day's chosen meals, in meal order. */
const ratingGroups = (day: Locator): Locator => day.getByRole("group", { name: /How was it\?/ });

/**
 * Waits until the rating island holding `group` has hydrated (Astro removes the island's `ssr` attribute then):
 * the faces are `client:visible`, so inside a closed day they hydrate only once it opens, and a tap before that
 * is lost.
 */
async function waitForHydration(page: Page, group: Locator): Promise<void> {
  await expect(page.locator("astro-island", { has: group })).not.toHaveAttribute("ssr");
}

/** Taps `face` once its island has hydrated and waits for the save to answer (no longer pending). */
async function tap(page: Page, group: Locator, face: string): Promise<void> {
  await waitForHydration(page, group);
  const button = group.getByRole("button", { name: face });
  await button.click();
  await expect(button).toHaveAttribute("aria-disabled", "false");
}

test("a fully rated day collapses, reopens from the keyboard and still rates (collapse-fully-rated-days)", async ({
  page,
  request,
}) => {
  // A delivery, a sign-in and three page loads on a cold preview.
  test.slow();
  const email = `e2e-rated-days-${randomUUID()}@example.com`;
  const password = `e2e-${randomUUID()}`;
  // Fixed for the run, as in the critical journey: this week's Monday is always inside the rating window.
  const today = todayInWarsaw(new Date());

  await test.step("MO delivers this week and the user signs in", async () => {
    // The delivery creates the account; the Admin API gives it a password instead of the invitation.
    await deliverWeek(request, { email, weekStart: thisMonday(today) });
    await ensureUserWithPassword(email, password);
    await signIn(page, email, password);
  });

  const thisWeek = page.getByRole("tabpanel", { name: "This week" });
  const monday = dayCard(thisWeek, "Monday");
  // The collapsed day's own disclosure, a direct child of the card (each meal's "Other options" is a nested one).
  const mondayDisclosure = monday.locator(":scope > details");
  const mondaySummary = mondayDisclosure.locator(":scope > summary");
  const [first, second] = [ratingGroups(monday).nth(0), ratingGroups(monday).nth(1)];

  await test.step("rating both of Monday's meals presses their faces", async () => {
    await openTab(page, "This week");
    await expect(ratingGroups(monday)).toHaveCount(2);
    await tap(page, first, "Tasty");
    await tap(page, second, "Fine");
    await expect(first.getByRole("button", { name: "Tasty" })).toHaveAttribute("aria-pressed", "true");
    await expect(second.getByRole("button", { name: "Fine" })).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("after a reload Monday is one closed line and the next day is open", async () => {
    await page.reload();
    await openTab(page, "This week");
    // The day's heading stays exposed inside the summary: headings navigation (and dayCard) still find it.
    await expect(monday.getByRole("heading", { name: /^Monday\b/ })).toBeVisible();
    await expect(mondaySummary.getByRole("heading", { name: /^Monday\b/ })).toBeVisible();
    await expect(monday.getByText("All rated")).toBeVisible();
    await expect(mondayDisclosure).not.toHaveAttribute("open");
    await expect(ratingGroups(monday)).toHaveCount(0);

    // Tuesday is never rated here (and is in the future on a Monday), so it is a plain open card.
    const tuesday = dayCard(thisWeek, "Tuesday");
    await expect(tuesday.getByRole("heading", { name: /^Tuesday\b/ })).toBeVisible();
    await expect(tuesday.locator(":scope > details")).toHaveCount(0);
    await expect(tuesday.locator("[data-option-id]").first()).toBeVisible();
  });

  await test.step("Enter on Monday's summary opens it and shows the faces", async () => {
    await mondaySummary.focus();
    await page.keyboard.press("Enter");
    await expect(mondayDisclosure).toHaveAttribute("open");
    await expect(ratingGroups(monday)).toHaveCount(2);
    await expect(first.getByRole("button", { name: "Tasty" })).toHaveAttribute("aria-pressed", "true");
    await expect(second.getByRole("button", { name: "Fine" })).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("inside the reopened day a rating changes and another clears", async () => {
    await tap(page, first, "Chef's kiss");
    await expect(first.getByRole("button", { name: "Chef's kiss" })).toHaveAttribute("aria-pressed", "true");
    await expect(first.getByRole("button", { name: "Tasty" })).toHaveAttribute("aria-pressed", "false");

    // Tapping the selected face clears the rating.
    await tap(page, second, "Fine");
    await expect(second.getByRole("button", { pressed: true })).toHaveCount(0);
  });

  await test.step("after a reload Monday is open again: it is no longer fully rated", async () => {
    await page.reload();
    await openTab(page, "This week");
    await expect(monday.getByRole("heading", { name: /^Monday\b/ })).toBeVisible();
    await expect(mondayDisclosure).toHaveCount(0);
    await expect(monday.getByText("All rated")).toHaveCount(0);
    await expect(first.getByRole("button", { name: "Chef's kiss" })).toHaveAttribute("aria-pressed", "true");
    await expect(second.getByRole("button", { pressed: true })).toHaveCount(0);
  });
});
