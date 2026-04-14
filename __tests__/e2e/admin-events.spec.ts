import { test, expect } from "@playwright/test"

// This test assumes a seeded admin account; skip if ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD are missing.
const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

test.describe("Admin events CMS", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test("admin can navigate to events list", async ({ page }) => {
    await page.goto("/login")
    await page.fill("input[name='email']", adminEmail!)
    await page.fill("input[name='password']", adminPassword!)
    await page.click("button[type='submit']")
    await page.waitForURL(/\/admin/)

    await page.goto("/admin/events")
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible()
    await expect(page.getByRole("link", { name: /new event/i })).toBeVisible()
  })
})
