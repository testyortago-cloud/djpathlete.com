import { describe, expect, it, afterAll } from "vitest"
import {
  createOrderDownload,
  consumeDownload,
  listDownloadsForOrder,
  revokeDownload,
  extendDownloadAccess,
} from "@/lib/db/shop-order-downloads"
import { createServiceRoleClient } from "@/lib/supabase"
import { TestCleanup } from "../../_helpers/cleanup"

const cleanup = new TestCleanup()

async function seed() {
  const supabase = createServiceRoleClient()
  const { data: product } = await supabase
    .from("shop_products")
    .insert({
      slug: `ds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "d",
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
      order_number: "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      customer_email: "x@x.com",
      customer_name: "x",
      shipping_address: {},
      status: "paid",
      items: [],
      subtotal_cents: 0,
      shipping_cents: 0,
      total_cents: 0,
    })
    .select("id")
    .single()
  cleanup.trackOrder(order!.id)
  return { productId: product!.id, fileId: file!.id, orderId: order!.id }
}

describe("shop-order-downloads DAL", () => {
  afterAll(async () => {
    await cleanup.run()
  })
  it("creates then lists a download", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId,
      product_id: productId,
      file_id: fileId,
      access_expires_at: null,
      max_downloads: null,
    })
    const list = await listDownloadsForOrder(orderId)
    expect(list.find((x) => x.id === d.id)?.download_count).toBe(0)
  })

  it("consumeDownload increments count and returns row", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId,
      product_id: productId,
      file_id: fileId,
      access_expires_at: null,
      max_downloads: 2,
    })
    const first = await consumeDownload(d.id)
    expect(first?.download_count).toBe(1)
    const second = await consumeDownload(d.id)
    expect(second?.download_count).toBe(2)
    const third = await consumeDownload(d.id)
    expect(third).toBeNull()
  })

  it("consumeDownload returns null when expired", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId,
      product_id: productId,
      file_id: fileId,
      access_expires_at: new Date(Date.now() - 1000).toISOString(),
      max_downloads: null,
    })
    expect(await consumeDownload(d.id)).toBeNull()
  })

  it("revokeDownload sets access_expires_at to now", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId,
      product_id: productId,
      file_id: fileId,
      access_expires_at: null,
      max_downloads: null,
    })
    await revokeDownload(d.id)
    expect(await consumeDownload(d.id)).toBeNull()
  })

  it("extendDownloadAccess pushes expiry forward", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId,
      product_id: productId,
      file_id: fileId,
      access_expires_at: new Date(Date.now() - 1000).toISOString(),
      max_downloads: null,
    })
    const future = new Date(Date.now() + 60_000).toISOString()
    await extendDownloadAccess(d.id, future)
    expect(await consumeDownload(d.id)).not.toBeNull()
  })
})
