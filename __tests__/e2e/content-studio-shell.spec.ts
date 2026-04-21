import { test, expect, type Page } from "@playwright/test"

// Admin credentials come from env; tests skip gracefully if not set so CI doesn't fail
// on a fresh checkout without the admin seed.
const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

async function loginAsAdmin(page: Page) {
  await page.goto("/login")
  await page.fill("input[name='email']", adminEmail!)
  await page.fill("input[name='password']", adminPassword!)
  await page.click("button[type='submit']")
  await page.waitForURL(/\/admin/)
}

test.describe("Content Studio shell", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("pipeline is the default tab", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("heading", { name: "Content Studio" })).toBeVisible()
    await expect(page.getByRole("link", { name: /Pipeline/ })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("heading", { name: /^Pipeline$/ })).toBeVisible()
  })

  test("clicking Calendar tab switches content", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await page.getByRole("link", { name: /Calendar/ }).click()
    await expect(page).toHaveURL(/\?tab=calendar/)
    await expect(page.getByRole("heading", { name: /^Calendar$/ })).toBeVisible()
  })

  test("deep-link /admin/content/[videoId] opens drawer over tab", async ({ page }) => {
    const response = await page.goto("/admin/content/test-video-xyz")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("dialog", { name: /Video detail: test-video-xyz/ })).toBeVisible()
    await expect(page.getByText(/Video · test-video-xyz/)).toBeVisible()
  })

  test("ESC closes the drawer and preserves the tab", async ({ page }) => {
    const response = await page.goto("/admin/content/test-video-xyz?tab=calendar")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page).toHaveURL(/\/admin\/content\?tab=calendar/)
    await expect(page.getByRole("dialog")).toBeHidden()
  })

  test("legacy /admin/videos redirects to Videos tab when flag on", async ({ page }) => {
    const response = await page.goto("/admin/videos")
    if (!page.url().includes("/admin/content")) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page).toHaveURL(/\/admin\/content\?tab=videos/)
    await expect(page.getByRole("link", { name: /Videos/ })).toHaveAttribute("aria-current", "page")
  })

  test("legacy /admin/social redirects to Posts tab when flag on", async ({ page }) => {
    const response = await page.goto("/admin/social")
    if (!page.url().includes("/admin/content")) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page).toHaveURL(/\/admin\/content\?tab=posts/)
  })

  test("legacy /admin/calendar redirects to Calendar tab when flag on", async ({ page }) => {
    const response = await page.goto("/admin/calendar")
    if (!page.url().includes("/admin/content")) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page).toHaveURL(/\/admin\/content\?tab=calendar/)
  })
})
