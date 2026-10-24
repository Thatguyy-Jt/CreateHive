import { expect, test } from "@playwright/test";

// Stateless, signed-out checks. Also run at phone width (chromium-mobile).

test("homepage renders with a way to sign up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href="/sign-up"]').filter({ visible: true }).first()).toBeVisible();
});

test("pricing shows Free and Pro at ₦12,000", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("Free", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Pro", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("₦12,000").filter({ visible: true }).first()).toBeVisible();
});

test("the app sends signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("health check answers", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toMatch(/^(ok|degraded)$/);
});

test("the cron endpoint refuses calls without its secret", async ({ request }) => {
  const response = await request.get("/api/cron/daily");
  // 401 with CRON_SECRET set, 503 without: refused either way.
  expect([401, 503]).toContain(response.status());
});
