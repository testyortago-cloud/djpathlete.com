import { test, expect, type Page } from "@playwright/test"

// Requires CONTENT_STUDIO_ENABLED=true plus a seeded admin and at least one
// video_uploads row with a transcript and social_posts. The test skips if
// no data is present so it can run in CI without pre-seeding.

const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

async function loginAsAdmin(page: Page) {
  await page.goto("/login")
  await page.fill("input[name='email']", adminEmail!)
  await page.fill("input[name='password']", adminPassword!)
  await page.click("button[type='submit']")
  await page.waitForURL(/\/admin/)
}

async function firstVideoIdWithPosts(page: Page): Promise<string | null> {
  const res = await page.request.get("/api/admin/videos")
  if (!res.ok()) return null
  const body = (await res.json()) as { videos?: Array<{ id: string }> } | Array<{ id: string }>
  const arr = Array.isArray(body) ? body : (body.videos ?? [])
  return arr[0]?.id ?? null
}

test.describe("Content Studio drawer", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test("opens with video player + transcript tab by default", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator("video")).toHaveCount(1)
    await expect(dialog.getByRole("tab", { name: /Transcript/ })).toHaveAttribute("aria-selected", "true")
  })

  test("switches to Posts tab via URL", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}?tab=posts`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("tab", { name: /Posts/ })).toHaveAttribute("aria-selected", "true")
  })

  test("clicking Meta tab updates the URL", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await page.getByRole("tab", { name: /Meta/ }).click()
    await expect(page).toHaveURL(/drawerTab=meta/)
    await expect(page.getByText(/Storage path/i)).toBeVisible()
  })

  test("ESC closes and restores /admin/content", async ({ page }) => {
    const videoId = await firstVideoIdWithPosts(page)
    test.skip(!videoId, "No seeded video with posts")

    const response = await page.goto(`/admin/content/${videoId}`)
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page).toHaveURL(/\/admin\/content$/)
    await expect(page.getByRole("dialog")).toBeHidden()
  })

  test("non-existent video id returns 404", async ({ page }) => {
    const response = await page.goto("/admin/content/00000000-0000-0000-0000-000000000000")
    // With flag off: 404 from notFound() in layout. With flag on: 404 from the
    // videoId page when the video doesn't exist.
    expect(response?.status()).toBe(404)
  })
})
