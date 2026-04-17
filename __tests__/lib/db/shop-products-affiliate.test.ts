import { describe, expect, it } from "vitest"
import {
  createAffiliateProduct,
  listProductsByType,
} from "@/lib/db/shop-products"

describe("createAffiliateProduct", () => {
  it("creates with product_type='affiliate'", async () => {
    const product = await createAffiliateProduct({
      name: "Test Aff " + Date.now(),
      slug: "test-aff-" + Date.now(),
      description: "<p>hi</p>",
      thumbnail_url: "https://x/img.jpg",
      affiliate_url: "https://www.amazon.com/dp/B000",
      affiliate_asin: "B000XXXXXX",
      affiliate_price_cents: 1999,
    })
    expect(product.product_type).toBe("affiliate")
    expect(product.affiliate_url).toContain("amazon.com")
    expect(product.is_active).toBe(false)
  })
})

describe("listProductsByType", () => {
  it("filters by type", async () => {
    const list = await listProductsByType("affiliate")
    expect(list.every((p) => p.product_type === "affiliate")).toBe(true)
  })
})
