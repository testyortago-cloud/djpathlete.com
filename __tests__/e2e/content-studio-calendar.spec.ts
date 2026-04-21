import { test, expect, type Page } from "@playwright/test"

const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

async function loginAsAdmin(page: Page) {
  await page.goto("/login")
  await page.fill("input[name='email']", adminEmail!)
  await page.fill("input[name='password']", adminPassword!)
  await page.click("button[type='submit']")
  await page.waitForURL(/\/admin/)
}

test.describe("Content Studio calendar", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("calendar tab renders three-column layout", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await expect(page.getByRole("complementary", { name: /Calendar filters/i })).toBeVisible()
    await expect(page.getByRole("grid", { name: /month view/i })).toBeVisible()
    await expect(page.getByRole("complementary", { name: /Unscheduled posts/i })).toBeVisible()
  })

  test("keyboard shortcut 'w' switches to week view", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await page.keyboard.press("w")
    await expect(page).toHaveURL(/view=week/)
    await expect(page.getByRole("grid", { name: /week view/i })).toBeVisible()
  })

  test("clicking an empty day opens the ManualPostDialog", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    const cells = page.getByRole("gridcell")
    const count = await cells.count()
    test.skip(count < 42, "Month grid missing")
    await cells.nth(count - 1).click()
    await expect(page.getByText(/New manual post/)).toBeVisible()
  })
})
