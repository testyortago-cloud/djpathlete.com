import { test, expect } from "@playwright/test"

// Assumes seeded FREE digital product with slug "e2e-digi-free" and at least one file,
// SHOP_DIGITAL_ENABLED=true.
test("free PDF flow shows check-your-email state", async ({ page }) => {
  await page.goto("/shop/e2e-digi-free")
  await page.fill("input[type=email]", `e2e-${Date.now()}@example.com`)
  await page.getByRole("button", { name: /get free download/i }).click()
  await expect(page.getByText(/check your email/i)).toBeVisible()
})
