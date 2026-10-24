import { expectNoErrorScreen, expect, PROFILE, signedInTest as test } from "./fixtures";

// Runs on the fresh creator global setup prepared (navigation.spec.ts only
// reads). AI is off, so strategy generation reports "paused".

test("a new creator completes onboarding and lands on Strategy", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("link", { name: "Set up my profile" }).first().click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { level: 1, name: "Tell us about your content" })).toBeVisible();

  // Step 1, empty: the server rejects it and marks the fields.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Your niche")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Tell us about your content" })).toBeVisible();

  // Step 1, filled.
  await page.getByLabel("Your niche").fill(PROFILE.niche);
  await page.getByLabel("Who you make content for").fill(PROFILE.audience);
  await page.getByRole("group", { name: "Your goals" }).getByRole("checkbox").first().check({ force: true });
  await page.getByRole("group", { name: "Where you post" }).getByRole("checkbox").first().check({ force: true });
  await page.getByLabel("Posts you can make per week").fill(PROFILE.postsPerWeek);
  await page.getByLabel("Where you are today").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2.
  await expect(page.getByRole("heading", { level: 1, name: "How do you sound?" })).toBeVisible();
  await page.getByLabel("Your tone").fill(PROFILE.tone);
  await page.getByRole("group", { name: "Voice traits" }).getByRole("checkbox").first().check({ force: true });
  await page.getByRole("button", { name: "Save and build my strategy" }).click();

  // Saved; generation is paused, and the page says so instead of crashing.
  await expect(page).toHaveURL(/\/app\/strategy/);
  await expect(page.getByText("AI features are paused right now.", { exact: false })).toBeVisible();
  await expectNoErrorScreen(page);

  // The profile persisted.
  await page.goto("/onboarding");
  await expect(page.getByLabel("Your niche")).toHaveValue(PROFILE.niche);
});
