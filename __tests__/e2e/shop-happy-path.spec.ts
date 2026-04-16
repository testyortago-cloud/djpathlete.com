import { test, expect } from "@playwright/test"

// Preconditions: SHOP_ENABLED=true in .env.local and at least one active product seeded in shop_products table.
// This test is documentation-quality and should be run manually with proper seeded data.

test.describe("Shop happy path", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      window.localStorage.clear()
    })
  })

  test("browse, cart, checkout up to Stripe redirect", async ({ page }) => {
    // Navigate to shop and verify heading
    await page.goto("/shop")
    await expect(page.getByRole("heading", { level: 1, name: /shop/i })).toBeVisible()

    // Click first product card
    const firstCard = page.locator("a[href^='/shop/']").first()
    await firstCard.click()

    // Select size if present
    const sizePicker = page.getByRole("radiogroup", { name: /size/i })
    if (await sizePicker.isVisible().catch(() => false)) {
      await sizePicker.locator("input").first().check()
    }

    // Add to cart
    await page.getByRole("button", { name: /add to cart/i }).click()

    // Navigate to cart and checkout
    await page.goto("/shop/cart")
    await page.getByRole("link", { name: /checkout/i }).click()

    // Fill address form
    await page.getByLabel(/name/i).fill("Test Buyer")
    await page.getByLabel(/email/i).fill("test@example.com")
    await page.getByLabel(/address/i).first().fill("123 Test St")
    await page.getByLabel(/city/i).fill("Austin")
    await page.getByLabel(/state/i).fill("TX")
    await page.getByLabel(/country/i).fill("US")
    await page.getByLabel(/postal/i).fill("78701")

    // Mock quote endpoint to avoid real Printful call
    await page.route("**/api/shop/quote", async (route) => {
      await route.fulfill({
        json: {
          shipping_cents: 499,
          shipping_label: "Standard",
          subtotal_cents: 2500,
          total_cents: 2999,
        },
      })
    })

    // Click get quote / continue
    await page.getByRole("button", { name: /get quote|continue/i }).click()

    // Verify quote summary is shown
    await expect(page.getByText(/\$29\.99/)).toBeVisible()

    // Mock checkout endpoint and capture the request body
    let postBody: unknown = null
    await page.route("**/api/shop/checkout", async (route) => {
      postBody = route.request().postDataJSON()
      await route.fulfill({
        json: { url: "https://checkout.stripe.com/test", order_number: "DJP-TESTTEST" },
      })
    })

    // Click pay button
    await page.getByRole("button", { name: /pay with stripe/i }).click()

    // Verify the checkout request body contains the expected shipping_cents
    expect(postBody).toMatchObject({ shipping_cents: 499 })
  })
})
