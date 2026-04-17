import { describe, expect, it } from "vitest"
import { createDigitalProduct } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"

describe("createDigitalProduct", () => {
  it("creates product + single variant for paid", async () => {
    const product = await createDigitalProduct({
      name: "Paid Digital " + Date.now(),
      slug: "paid-digi-" + Date.now(),
      description: "<p>test</p>",
      thumbnail_url: "https://x/i.jpg",
      digital_is_free: false,
      retail_price_cents: 4900,
      digital_signed_url_ttl_seconds: 900,
      digital_access_days: 90,
      digital_max_downloads: 10,
    })
    expect(product.product_type).toBe("digital")
    expect(product.digital_is_free).toBe(false)
    const variants = await listVariantsForProduct(product.id)
    expect(variants.length).toBe(1)
    expect(variants[0].retail_price_cents).toBe(4900)
  })

  it("creates product WITHOUT variant for free", async () => {
    const product = await createDigitalProduct({
      name: "Free Digital " + Date.now(),
      slug: "free-digi-" + Date.now(),
      description: "",
      thumbnail_url: "https://x/i.jpg",
      digital_is_free: true,
      digital_signed_url_ttl_seconds: 900,
    })
    expect(product.digital_is_free).toBe(true)
    const variants = await listVariantsForProduct(product.id)
    expect(variants.length).toBe(0)
  })
})
