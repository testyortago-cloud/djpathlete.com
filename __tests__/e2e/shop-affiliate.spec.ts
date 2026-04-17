import { test, expect } from "@playwright/test"

// This test assumes: SHOP_ENABLED=true, SHOP_AFFILIATE_ENABLED=true,
// and at least one active affiliate product exists in the DB with slug "e2e-aff".
test("affiliate card redirects to amazon with tag", async ({ page, context }) => {
  await page.goto("/shop")
  const pagePromise = context.waitForEvent("page")
  await page.getByRole("link", { name: /e2e-aff|amazon/i }).first().click()
  const newPage = await pagePromise
  await newPage.waitForURL(/amazon\./)
  expect(newPage.url()).toContain("tag=")
})
