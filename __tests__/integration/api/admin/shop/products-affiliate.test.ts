import { describe, expect, it, vi, afterAll } from "vitest"
import { POST } from "@/app/api/admin/shop/products/affiliate/route"
import { TestCleanup } from "../../../_helpers/cleanup"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))

const cleanup = new TestCleanup()

describe("POST /api/admin/shop/products/affiliate", () => {
  afterAll(async () => {
    await cleanup.run()
  })

  it("creates affiliate product on valid payload", async () => {
    const req = new Request("http://x/api/admin/shop/products/affiliate", {
      method: "POST",
      body: JSON.stringify({
        name: "API Aff Test " + Date.now(),
        slug: "api-aff-" + Date.now(),
        description: "",
        thumbnail_url: "https://x/i.jpg",
        affiliate_url: "https://www.amazon.com/dp/B001",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.product.product_type).toBe("affiliate")
    cleanup.trackProduct(body.product.id)
  })

  it("rejects non-amazon url", async () => {
    const req = new Request("http://x/api/admin/shop/products/affiliate", {
      method: "POST",
      body: JSON.stringify({
        name: "x",
        slug: "x-" + Date.now(),
        description: "",
        thumbnail_url: "https://x/i.jpg",
        affiliate_url: "https://walmart.com/x",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
