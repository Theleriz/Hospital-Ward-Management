import { defineConfig, devices } from "@playwright/test";

// End-to-end tests in a real browser against the running system
// (docker compose up -d --build --wait): staff app on 8080, corridor board on 8081.
// Other addresses: MEDBASE_E2E_APP_URL and MEDBASE_E2E_BOARD_URL. Browser: Playwright's
// Chromium (npx playwright install chromium), or an installed one via
// MEDBASE_E2E_CHANNEL=msedge / chrome.
// The tests change data (they raise and acknowledge alerts), so they run one at a time
// against a fresh database, as in CI.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.MEDBASE_E2E_APP_URL ?? "http://127.0.0.1:8080",
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.MEDBASE_E2E_CHANNEL } },
  ],
});
