import { test, expect } from "@playwright/test"

// Assumes seeded paid digital product with slug "e2e-digi-paid" and at least one file,
// Stripe test mode, SHOP_DIGITAL_ENABLED=true.
test("paid digital purchase ends on downloads page with a working file", async ({ page }) => {
  await page.goto("/shop/e2e-digi-paid")
  await page.getByRole("button", { name: /add to cart/i }).click()
  await page.goto("/shop/cart")
  await page.getByRole("link", { name: /checkout/i }).click()
  await page.fill("input[name=email]", "e2e@example.com")
  await page.fill("input[name=line1]", "1 Test St")
  await page.fill("input[name=city]", "Testville")
  await page.fill("input[name=state]", "CA")
  await page.fill("input[name=postal_code]", "94102")
  await page.selectOption("select[name=country]", "US")
  await page.getByRole("button", { name: /pay|continue/i }).click()
  await page.waitForURL(/thank-you/)
  await page.getByRole("link", { name: /go to downloads/i }).click()
  await page.fill("input[type=email]", "e2e@example.com")
  await page.getByRole("button", { name: /show downloads/i }).click()
  await expect(page.getByRole("button", { name: /download/i }).first()).toBeVisible()
})
