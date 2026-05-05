import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { GET } from "@/app/(marketing)/shop/go/[productId]/route"
import { createServiceRoleClient } from "@/lib/supabase"
import { TestCleanup } from "../../_helpers/cleanup"

describe("GET /shop/go/[productId]", () => {
  let productId: string
  const cleanup = new TestCleanup()

  beforeAll(async () => {
    process.env.AMAZON_ASSOCIATES_TAG = "djp-20"
    process.env.SHOP_AFFILIATE_ENABLED = "true"
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `go-test-${Date.now()}`,
        name: "go-test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "affiliate",
        affiliate_url: "https://www.amazon.com/dp/B000",
        is_active: true,
      })
      .select("id")
      .single()
    productId = data!.id
    cleanup.trackProduct(productId)
  })

  afterAll(async () => {
    await cleanup.run()
  })

  it("302-redirects with tag appended", async () => {
    const req = new Request("http://localhost/shop/go/" + productId)
    const res = await GET(req, { params: Promise.resolve({ productId }) })
    expect(res.status).toBe(307)
    const loc = res.headers.get("location")
    expect(loc).toContain("amazon.com/dp/B000")
    expect(loc).toContain("tag=djp-20")
  })

  it("404s when affiliate flag is off", async () => {
    process.env.SHOP_AFFILIATE_ENABLED = "false"
    const req = new Request("http://localhost/shop/go/" + productId)
    const res = await GET(req, { params: Promise.resolve({ productId }) })
    expect(res.status).toBe(404)
    process.env.SHOP_AFFILIATE_ENABLED = "true"
  })

  it("404s on unknown product", async () => {
    const req = new Request("http://localhost/shop/go/00000000-0000-0000-0000-000000000000")
    const res = await GET(req, {
      params: Promise.resolve({ productId: "00000000-0000-0000-0000-000000000000" }),
    })
    expect(res.status).toBe(404)
  })
})
