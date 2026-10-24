import { readFile } from "node:fs/promises";
import { expect, PROFILE, signedInTest as test } from "./fixtures";

// Runs after onboarding.spec.ts (file order, one worker), so the creator has a
// profile. Never actually deletes the account: the suite must stay rerunnable.

test("download my data returns this creator's data as JSON", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download my data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^createhive-data-\d{4}-\d{2}-\d{2}\.json$/);

  const text = await readFile(await download.path(), "utf8");
  const data = JSON.parse(text);
  expect(data.format_version).toBe(1);
  expect(data.tables.creator_profiles).toHaveLength(1);
  expect(data.tables.creator_profiles[0].niche).toBe(PROFILE.niche);
  expect(text).not.toContain('"user_id"');
});

test("deleting the account needs DELETE typed, and can be backed out of", async ({ page }) => {
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Delete account…" }).click();

  const keep = page.getByRole("button", { name: "Keep my account" });
  const confirm = page.getByRole("button", { name: "Delete my account" });
  await expect(keep).toBeFocused();
  await expect(confirm).toBeDisabled();

  const input = page.getByLabel("Type DELETE to confirm");
  await input.fill("delete");
  await expect(confirm).toBeDisabled();
  await input.fill("DELETE");
  await expect(confirm).toBeEnabled();

  await keep.click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account…" })).toBeVisible();
});
