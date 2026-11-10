import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, browserOptions } from "./tests/e2e/support/env";

/**
 * End-to-end tests (tests/e2e). They run against a running app (E2E_BASE_URL, default http://localhost:3000) and its
 * database, one worker at a time (tests share the seed accounts and the app's cached settings/content). The global
 * teardown restores the database exactly as it was before the run. See README → Testing.
 */
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e/specs",
  outputDir: "./test-results/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: CI ? 2 : 0,
  forbidOnly: CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["junit", { outputFile: "test-results/e2e-junit.xml" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ...browserOptions(),
  },
  // Optional: let Playwright start the production server (CI). Locally the app is usually already running.
  ...(process.env.E2E_START_SERVER === "1"
    ? { webServer: { command: "npm run start", url: `${BASE_URL}/api/health`, reuseExistingServer: !CI, timeout: 120_000 } }
    : {}),
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Mobile smoke: only tests tagged @smoke, on a phone-sized Chromium viewport.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@smoke/ },
  ],
});
