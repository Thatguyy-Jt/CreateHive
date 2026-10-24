import { clerk } from "@clerk/testing/playwright";
import { test as base, expect } from "@playwright/test";

export const TEST_EMAIL = process.env.E2E_CLERK_USER_EMAIL?.trim() ?? "";

/** What the onboarding spec enters; later specs check it came through. */
export const PROFILE = {
  niche: "home workouts for busy parents",
  audience:
    "Parents with young kids who want to stay fit at home. They have 20 minutes a day and no gym equipment.",
  postsPerWeek: "3",
  tone: "warm and practical",
};

/**
 * A test that runs signed in as the dedicated test creator (reset by global
 * setup). Skipped, with the reason, when no test creator is configured.
 */
export const signedInTest = base.extend({
  // Playwright's fixture callback; not named `use` so the React hooks lint rule doesn't mistake it.
  page: async ({ page }, provide) => {
    base.skip(!TEST_EMAIL, "Set E2E_CLERK_USER_EMAIL to a Clerk development user to run signed-in tests.");
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: TEST_EMAIL });
    await provide(page);
  },
});

/** The shared error screen must never show. */
export async function expectNoErrorScreen(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
}

export { expect };
