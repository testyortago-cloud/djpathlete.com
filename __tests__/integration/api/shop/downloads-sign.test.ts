import { describe, expect, it, vi, afterAll } from "vitest"
import { POST } from "@/app/api/shop/downloads/sign/route"
import { createServiceRoleClient } from "@/lib/supabase"
import { TestCleanup } from "../../_helpers/cleanup"

vi.mock("@/lib/shop/downloads", () => ({
  generateSignedDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/x"),
}))

const cleanup = new TestCleanup()

async function seedFullOrderWithDownload() {
  const supabase = createServiceRoleClient()
  const suffix = Date.now() + "-" + Math.random().toString(36).slice(2, 6)
  const { data: product } = await supabase
    .from("shop_products")
    .insert({
      slug: `sg-${suffix}`,
      name: "x",
      description: "",
      thumbnail_url: "https://x/i.jpg",
      product_type: "digital",
    })
    .select("id")
    .single()
  cleanup.trackProduct(product!.id)
  const { data: file } = await supabase
    .from("shop_product_files")
    .insert({
      product_id: product!.id,
      file_name: "a.pdf",
      display_name: "a",
      storage_path: "p/a.pdf",
      file_size_bytes: 1,
      mime_type: "application/pdf",
    })
    .select("id")
    .single()
  const { data: order } = await supabase
    .from("shop_orders")
    .insert({
      order_number: `T-${suffix}`,
      customer_email: "u@x.com",
      customer_name: "x",
      shipping_address: {},
      status: "fulfilled_digital",
      items: [],
      subtotal_cents: 0,
      shipping_cents: 0,
      total_cents: 0,
    })
    .select("id, order_number, customer_email")
    .single()
  cleanup.trackOrder(order!.id)
  const { data: download } = await supabase
    .from("shop_order_downloads")
    .insert({
      order_id: order!.id,
      product_id: product!.id,
      file_id: file!.id,
      access_expires_at: null,
      max_downloads: null,
    })
    .select("id")
    .single()
  return { order, downloadId: download!.id }
}

describe("POST /api/shop/downloads/sign", () => {
  afterAll(async () => {
    await cleanup.run()
  })
  it("returns signed URL on valid email match", async () => {
    const { order, downloadId } = await seedFullOrderWithDownload()
    const req = new Request("http://x/api/shop/downloads/sign", {
      method: "POST",
      body: JSON.stringify({
        order_number: order!.order_number,
        email: order!.customer_email,
        download_id: downloadId,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain("signed.example")
  })

  it("rejects mismatched email", async () => {
    const { order, downloadId } = await seedFullOrderWithDownload()
    const req = new Request("http://x/api/shop/downloads/sign", {
      method: "POST",
      body: JSON.stringify({
        order_number: order!.order_number,
        email: "wrong@x.com",
        download_id: downloadId,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
