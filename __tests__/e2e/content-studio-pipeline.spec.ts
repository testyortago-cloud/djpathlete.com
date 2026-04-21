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

test.describe("Content Studio pipeline", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("pipeline renders Videos + Posts lanes", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("region", { name: /Videos/ })).toBeVisible()
    await expect(page.getByRole("region", { name: /Posts/ })).toBeVisible()
    await expect(page.getByText("Needs Review")).toBeVisible()
    await expect(page.getByText(/^Approved$/)).toBeVisible()
    await expect(page.getByText(/^Published$/)).toBeVisible()
  })

  test("platform filter narrows posts", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await page.getByRole("button", { name: /^Instagram$/i }).first().click()
    await expect(page).toHaveURL(/platform=instagram/)
  })

  test("Videos tab shows a table", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=videos")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await expect(page.getByRole("columnheader", { name: /Filename/i })).toBeVisible()
  })

  test("Posts tab shows a table with source-video column", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=posts")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    await expect(page.getByRole("columnheader", { name: /Source video/i })).toBeVisible()
  })

  test("clicking a post row in Posts tab opens the post-only drawer", async ({ page }) => {
    const response = await page.goto("/admin/content?tab=posts")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const firstLink = page.locator("tbody a").first()
    const count = await firstLink.count()
    test.skip(count === 0, "No posts to click")
    await firstLink.click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/content\/post\//)
  })
})
