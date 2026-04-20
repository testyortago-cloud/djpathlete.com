import { test, expect, type Page } from "@playwright/test"

// This test assumes a seeded admin account; skip if ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD are missing.
const adminEmail = process.env.ADMIN_TEST_EMAIL
const adminPassword = process.env.ADMIN_TEST_PASSWORD

const TEST_TEMPLATE_NAME = "__E2E_TEST__AI_TEMPLATE"

async function loginAsAdmin(page: Page) {
  await page.goto("/login")
  await page.fill("input[name='email']", adminEmail!)
  await page.fill("input[name='password']", adminPassword!)
  await page.click("button[type='submit']")
  await page.waitForURL(/\/admin/)
}

test.describe("AI Templates management", () => {
  test.skip(!adminEmail || !adminPassword, "Admin test credentials not set")

  test("admin can navigate to AI Templates page", async ({ page }) => {
    await loginAsAdmin(page)

    await page.goto("/admin/ai-templates")

    await expect(page.getByRole("heading", { name: "AI Templates" })).toBeVisible()
    await expect(page.getByRole("button", { name: /new template/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /create from idea/i })).toBeVisible()
  })

  test.describe.serial("create and delete template", () => {
    test("admin can create a custom template", async ({ page }) => {
      await loginAsAdmin(page)

      await page.goto("/admin/ai-templates")

      // Open the "New template" modal
      await page.getByRole("button", { name: /new template/i }).click()

      // Fill in the modal fields
      await page.getByLabel("Name").fill(TEST_TEMPLATE_NAME)
      await page.getByLabel("Description").fill("E2E test template — safe to delete")
      await page.getByLabel("Prompt").fill(
        "Focus on compound movements and progressive overload for the athlete.",
      )

      // Submit the form
      await page.getByRole("button", { name: /^create$/i }).click()

      // Verify success: either a toast appears or the row is in the table
      const rowVisible = page.getByRole("cell", { name: TEST_TEMPLATE_NAME })
      const toastVisible = page.getByText(/template created/i)

      await expect(rowVisible.or(toastVisible)).toBeVisible({ timeout: 8000 })

      // Also confirm the row eventually shows in the table after the list refreshes
      await expect(page.getByText(TEST_TEMPLATE_NAME)).toBeVisible({ timeout: 8000 })
    })

    test("admin can delete a custom template", async ({ page }) => {
      await loginAsAdmin(page)

      await page.goto("/admin/ai-templates")

      // Wait for the table to load and find our test row
      await expect(page.getByText(TEST_TEMPLATE_NAME)).toBeVisible({ timeout: 8000 })

      // Accept the window.confirm dialog that appears on delete
      page.on("dialog", (dialog) => dialog.accept())

      // Find the row containing the test template name and click its trash (delete) button
      const row = page.locator("tr", { has: page.getByText(TEST_TEMPLATE_NAME) })
      await row.getByRole("button").last().click()

      // Verify the row is removed from the table
      await expect(page.getByText(TEST_TEMPLATE_NAME)).not.toBeVisible({ timeout: 8000 })
    })
  })
})
