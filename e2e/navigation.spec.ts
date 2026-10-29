import { expectNoErrorScreen, expect, signedInTest as test } from "./fixtures";

// Every live page in the app shell loads without the error screen. Files run
// alphabetically, so this sees the brand-new creator before onboarding: every
// page must cope with no profile and no data. Visited by URL, so desktop and
// mobile nav don't matter.

const PAGES = [
  "/app",
  "/app/strategy",
  "/app/opportunities",
  "/app/calendar",
  "/app/studio",
  "/app/analytics",
  "/app/insights",
  "/app/research",
  "/app/breakdown",
  "/app/settings",
  "/app/settings/billing",
];

for (const path of PAGES) {
  test(`${path} loads`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoErrorScreen(page);
  });
}
