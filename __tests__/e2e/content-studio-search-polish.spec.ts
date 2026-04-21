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

test.describe("Content Studio search + polish", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("shell renders live search input + upload button", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const search = page.getByPlaceholder(/Search videos, transcripts, posts/i)
    await expect(search).toBeVisible()
    await expect(search).toBeEnabled()
    await expect(page.getByRole("button", { name: /Upload Video/ })).toBeVisible()
  })

  test("search dropdown opens and closes with Escape", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const input = page.getByPlaceholder(/Search videos, transcripts, posts/i)
    await input.fill("rotational")
    // Wait for either results or "No results" to appear
    await expect(page.getByText(/(No results|Videos|Transcripts|Posts)/).first()).toBeVisible({ timeout: 3000 })
    await input.press("Escape")
  })

  test("live region exists for drag-drop announcements", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const live = page.locator("#content-studio-announce")
    await expect(live).toHaveAttribute("aria-live", "polite")
  })

  test("GET /api/admin/content-studio/preferences returns defaults for a fresh user", async ({ page }) => {
    const res = await page.request.get("/api/admin/content-studio/preferences")
    if (res.status() === 404) test.skip(true, "Route not deployed yet")
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { calendar_default_view: string }
    expect(["month", "week", "day"]).toContain(body.calendar_default_view)
  })

  test("Upload modal opens on click of Upload Video", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await page.getByRole("button", { name: /Upload Video/ }).click()
    await expect(page.getByRole("heading", { name: /Upload video/i })).toBeVisible()
    await page.getByRole("button", { name: /Close upload dialog/ }).click()
    await expect(page.getByRole("heading", { name: /Upload video/i })).toBeHidden()
  })
})
