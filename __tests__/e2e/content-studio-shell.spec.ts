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
    const tabs = page.getByRole("main").getByRole("navigation")
    await expect(tabs.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute("aria-current", "page")
    // The board identifies itself by its lanes -- there is no "Pipeline" heading.
    await expect(page.getByRole("heading", { name: "Videos", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Posts", exact: true })).toBeVisible()
  })

  test("clicking Calendar tab switches content", async ({ page }) => {
    const response = await page.goto("/admin/content")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")

    const tabs = page.getByRole("main").getByRole("navigation")
    await tabs.getByRole("link", { name: "Calendar", exact: true }).click()
    await expect(page).toHaveURL(/\?tab=calendar/)
    await expect(tabs.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page")

    // The month grid is the calendar's own content (there is no "Calendar"
    // heading), and the pipeline lanes are gone -- so the content really swapped.
    await expect(
      page.getByRole("heading", {
        name: /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/,
      }),
    ).toBeVisible()
    await expect(page.getByRole("heading", { name: "Posts", exact: true })).toHaveCount(0)
  })

  // A video opens as a FULL PAGE at /admin/content/[videoId]. It used to be a
  // drawer layered over the tab content, and these two tests asserted that
  // dialog long after it was gone -- they never failed because the whole
  // describe block was skipping (see the dotenv note in playwright.config.ts).
  async function openFirstVideo(page: Page) {
    const response = await page.goto("/admin/content?tab=videos")
    if (response?.status() === 404) test.skip(true, "CONTENT_STUDIO_ENABLED not set")
    const link = page.locator('a[href^="/admin/content/"]').first()
    if ((await link.count()) === 0) test.skip(true, "No videos in this environment")
    const href = await link.getAttribute("href")
    await page.goto(href!)
    await expect(page).toHaveURL(new RegExp(`${href!.replace(/[/-]/g, "\\$&")}$`))
    return href!
  }

  test("deep-link /admin/content/[videoId] opens the full video page", async ({ page }) => {
    await openFirstVideo(page)

    // The full page, not the old drawer.
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByRole("main").getByRole("link", { name: "Content Studio", exact: true })).toBeVisible()
  })

  // Regression: the tab bar built its hrefs from the CURRENT path, so from a
  // video page every tab pointed back at that same video with a new ?tab=.
  // The underline moved and the URL changed while the video stayed on screen.
  test("tabs navigate away from a video page instead of re-pointing at it", async ({ page }) => {
    await openFirstVideo(page)

    const tabs = page.getByRole("main").getByRole("navigation")
    await expect(tabs.getByRole("link", { name: "Insights", exact: true })).toHaveAttribute(
      "href",
      "/admin/content?tab=insights",
    )

    await tabs.getByRole("link", { name: "Insights", exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/content\?tab=insights$/)
    await expect(tabs.getByRole("link", { name: "Insights", exact: true })).toHaveAttribute("aria-current", "page")
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
