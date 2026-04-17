import { describe, expect, it, beforeEach } from "vitest"
import {
  recordAffiliateClick,
  countClicksForProduct,
  countClicksForProductSince,
} from "@/lib/db/shop-affiliate-clicks"
import { createServiceRoleClient } from "@/lib/supabase"

describe("shop-affiliate-clicks DAL", () => {
  let productId: string

  beforeEach(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `test-aff-${Date.now()}`,
        name: "test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "affiliate",
        affiliate_url: "https://amazon.com/dp/B000",
      })
      .select("id")
      .single()
    productId = data!.id
  })

  it("records a click and counts it", async () => {
    await recordAffiliateClick({
      product_id: productId,
      ip_address: "1.2.3.4",
      user_agent: "ua",
      referrer: null,
    })
    expect(await countClicksForProduct(productId)).toBe(1)
  })

  it("counts clicks since a timestamp", async () => {
    await recordAffiliateClick({ product_id: productId })
    const since = new Date(Date.now() - 60_000).toISOString()
    const count = await countClicksForProductSince(productId, since)
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
