import { describe, expect, it, vi, beforeAll, afterAll } from "vitest"
import { POST } from "@/app/api/shop/leads/route"
import { createServiceRoleClient } from "@/lib/supabase"
import { TestCleanup } from "../../_helpers/cleanup"

vi.mock("@/lib/shop/resend-audience", () => ({
  addContactToAudience: vi.fn().mockResolvedValue("contact_mock"),
}))
vi.mock("@/lib/shop/emails", async () => {
  const actual = await vi.importActual<object>("@/lib/shop/emails")
  return {
    ...actual,
    sendFreeDownloadEmail: vi.fn().mockResolvedValue(undefined),
  }
})

describe("POST /api/shop/leads", () => {
  let productId: string
  const cleanup = new TestCleanup()

  beforeAll(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `lead-api-${Date.now()}`,
        name: "x",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "digital",
        digital_is_free: true,
        is_active: true,
      })
      .select("id")
      .single()
    productId = data!.id
    cleanup.trackProduct(productId)
    await supabase.from("shop_product_files").insert({
      product_id: productId,
      file_name: "x.pdf",
      display_name: "X",
      storage_path: "shop-downloads/x/x.pdf",
      file_size_bytes: 100,
      mime_type: "application/pdf",
    })
  })

  afterAll(async () => {
    await cleanup.run()
  })

  it("creates lead + calls Resend + sends email", async () => {
    process.env.SHOP_DIGITAL_ENABLED = "true"
    const req = new Request("http://x/api/shop/leads", {
      method: "POST",
      body: JSON.stringify({
        email: `u-${Date.now()}@x.com`,
        product_id: productId,
        website: "",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it("rejects honeypot", async () => {
    process.env.SHOP_DIGITAL_ENABLED = "true"
    const req = new Request("http://x/api/shop/leads", {
      method: "POST",
      body: JSON.stringify({
        email: "u@x.com",
        product_id: productId,
        website: "spam",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
