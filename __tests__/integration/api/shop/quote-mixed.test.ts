import { describe, expect, it, vi, afterAll } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"
import { TestCleanup } from "../../_helpers/cleanup"

vi.mock("@/lib/printful", () => {
  class PrintfulError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    PrintfulError,
    getShippingRates: vi.fn().mockResolvedValue([{ name: "Standard", rate: "9.99", currency: "USD" }]),
  }
})

const cleanup = new TestCleanup()

async function seedMixed() {
  const supabase = createServiceRoleClient()
  const suffix = Date.now() + "-" + Math.random().toString(36).slice(2, 6)
  const { data: podProduct } = await supabase
    .from("shop_products")
    .insert({
      slug: `pod-${suffix}`,
      name: "p",
      description: "",
      thumbnail_url: "https://x/i.jpg",
      product_type: "pod",
      printful_sync_id: Date.now(),
      is_active: true,
    })
    .select("id")
    .single()
  cleanup.trackProduct(podProduct!.id)
  const { data: podVariant } = await supabase
    .from("shop_product_variants")
    .insert({
      product_id: podProduct!.id,
      printful_sync_variant_id: Date.now(),
      printful_variant_id: 1001,
      sku: `sku-${suffix}`,
      name: "Default",
      retail_price_cents: 2000,
      printful_cost_cents: 1000,
      mockup_url: "https://x/m.jpg",
      mockup_urls: [],
      is_available: true,
    })
    .select("id, printful_variant_id")
    .single()
  const { data: digProduct } = await supabase
    .from("shop_products")
    .insert({
      slug: `dig-${suffix}`,
      name: "d",
      description: "",
      thumbnail_url: "https://x/i.jpg",
      product_type: "digital",
      digital_signed_url_ttl_seconds: 900,
      is_active: true,
    })
    .select("id")
    .single()
  cleanup.trackProduct(digProduct!.id)
  const { data: digVariant } = await supabase
    .from("shop_product_variants")
    .insert({
      product_id: digProduct!.id,
      sku: `d-${suffix}`,
      name: "Default",
      retail_price_cents: 4900,
      printful_cost_cents: 0,
      mockup_url: "https://x/m.jpg",
      mockup_urls: [],
      is_available: true,
    })
    .select("id")
    .single()
  return { podVariantId: podVariant!.id, digVariantId: digVariant!.id }
}

const ADDRESS = {
  name: "x",
  email: "u@x.com",
  phone: null,
  country: "US",
  state: "CA",
  postal_code: "94102",
  city: "SF",
  line1: "1 Main St",
  line2: null,
}

describe("POST /api/shop/quote (mixed cart)", () => {
  afterAll(async () => {
    await cleanup.run()
  })

  it("quotes shipping only for POD lines", async () => {
    process.env.SHOP_ENABLED = "true"
    const { POST } = await import("@/app/api/shop/quote/route")
    const { podVariantId, digVariantId } = await seedMixed()
    const req = new Request("http://x/api/shop/quote", {
      method: "POST",
      body: JSON.stringify({
        items: [
          { variant_id: podVariantId, quantity: 1 },
          { variant_id: digVariantId, quantity: 1 },
        ],
        address: ADDRESS,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.shipping_cents).toBe(999)
    expect(body.subtotal_cents).toBe(2000 + 4900)
  })

  it("returns 0 shipping for digital-only cart without hitting Printful", async () => {
    process.env.SHOP_ENABLED = "true"
    const { POST } = await import("@/app/api/shop/quote/route")
    const { digVariantId } = await seedMixed()
    const { getShippingRates } = await import("@/lib/printful")
    vi.mocked(getShippingRates).mockClear()
    const req = new Request("http://x/api/shop/quote", {
      method: "POST",
      body: JSON.stringify({
        items: [{ variant_id: digVariantId, quantity: 1 }],
        address: ADDRESS,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.shipping_cents).toBe(0)
    expect(body.subtotal_cents).toBe(4900)
    expect(vi.mocked(getShippingRates)).not.toHaveBeenCalled()
  })
})
