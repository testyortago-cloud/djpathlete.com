import { test, expect } from "@playwright/test"

// Needs a published camp seeded with stripe_price_id. Skip if PAID_CAMP_TEST_SLUG is missing.
const slug = process.env.PAID_CAMP_TEST_SLUG

test.describe("Paid camp booking", () => {
  test.skip(!slug, "PAID_CAMP_TEST_SLUG not set — scaffolding only")

  test("camp detail renders Book button with price label", async ({ page }) => {
    await page.goto(`/camps/${slug}`)

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    // The book button should include "$" in its label and not be disabled
    const bookBtn = page.getByRole("button", { name: /book camp — \$/i }).first()
    await expect(bookBtn).toBeVisible()
    await expect(bookBtn).toBeEnabled()
  })

  test("cancelled checkout banner renders when ?checkout=cancelled is set", async ({ page }) => {
    await page.goto(`/camps/${slug}?checkout=cancelled`)
    await expect(page.getByText(/checkout was cancelled/i)).toBeVisible()
  })
})
