import { defineConfig, devices } from "@playwright/test";

// Browser smoke tests (e2e/). The app under test is its own `next dev` on
// port 3100 with AI switched off, so no AI provider is ever called; it is
// never a reused server, which could have AI on. See docs/testing.md.

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
/** Stateless specs; everything else signs in as the shared test creator. */
const PUBLIC_SPECS = /public\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Signed-in specs share one creator: run them one at a time, in file order.
  workers: 1,
  fullyParallel: false,
  // Absorbs the dev server's first-compile slowness.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] }, testMatch: PUBLIC_SPECS },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { AI_ENABLED: "false" },
  },
});
