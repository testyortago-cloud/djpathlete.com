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

test.describe("Starter AI Automation — Phase 1 admin scaffolds", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test("sidebar shows AI Automation section with 3 items", async ({ page }) => {
    await loginAsAdmin(page)

    // The sidebar is always visible in admin layout
    await expect(page.getByRole("link", { name: "Social" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Videos" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Platform Connections" })).toBeVisible()
  })

  test("Social page renders with stat cards and empty state", async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto("/admin/social")

    await expect(page.getByRole("heading", { level: 1, name: "Social" })).toBeVisible()

    // Stat cards
    await expect(page.getByText("Drafts")).toBeVisible()
    await expect(page.getByText("Scheduled")).toBeVisible()
    await expect(page.getByText("Published")).toBeVisible()

    // Empty state
    await expect(page.getByRole("heading", { level: 2, name: "No social posts yet" })).toBeVisible()
  })

  test("Videos page renders with 3 stat cards, disabled upload button, and empty state", async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto("/admin/videos")

    await expect(page.getByRole("heading", { level: 1, name: "Videos" })).toBeVisible()

    // 3 stat cards
    await expect(page.getByText("Processing")).toBeVisible()
    await expect(page.getByText("Ready")).toBeVisible()
    await expect(page.getByText("Total")).toBeVisible()

    // Disabled upload button
    const uploadButton = page.getByRole("button", { name: /upload video/i })
    await expect(uploadButton).toBeVisible()
    await expect(uploadButton).toBeDisabled()

    // Empty state
    await expect(page.getByRole("heading", { level: 2, name: "No videos uploaded yet" })).toBeVisible()
  })

  test("Platform Connections page shows all 6 plugins, all not-connected, all Connect buttons disabled", async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto("/admin/platform-connections")

    await expect(page.getByRole("heading", { level: 1, name: "Platform Connections" })).toBeVisible()

    // All 6 plugin labels visible
    const expectedPlugins = ["Facebook", "Instagram", "TikTok", "YouTube", "YouTube Shorts", "LinkedIn"]
    for (const label of expectedPlugins) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }

    // 6 "Not connected" badges (all plugins are seeded in not_connected state)
    const notConnectedBadges = page.getByLabel("Not connected")
    await expect(notConnectedBadges).toHaveCount(6)

    // 6 disabled Connect buttons
    const connectButtons = page.getByRole("button", { name: /connect/i })
    await expect(connectButtons).toHaveCount(6)
    for (let i = 0; i < 6; i++) {
      await expect(connectButtons.nth(i)).toBeDisabled()
    }
  })
})
