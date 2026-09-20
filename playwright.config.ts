import { defineConfig, devices } from "@playwright/test"
import dotenv from "dotenv"

// Without this the specs that gate on ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD
// skipped their whole describe block even though .env.local defines both --
// which is how the Content Studio shell suite sat green while still asserting
// a drawer that had been replaced by a full page months earlier.
dotenv.config({ path: ".env.local" })

export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3050",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3050",
    reuseExistingServer: !process.env.CI,
  },
})
