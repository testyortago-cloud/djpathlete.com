import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import {
  listSyncProducts,
  getSyncProduct,
  getShippingRates,
  createOrder,
  confirmOrder,
  cancelOrder,
  verifyWebhookSignature,
} from "@/lib/printful"

const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn()
  process.env.PRINTFUL_API_KEY = "test_key"
  process.env.PRINTFUL_WEBHOOK_SECRET = "test_secret"
})
afterAll(() => {
  global.fetch = originalFetch
})

describe("Printful client", () => {
  it("listSyncProducts calls GET /store/products with bearer auth", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [{ id: 1, name: "Tee" }] })),
    )
    const result = await listSyncProducts()
    expect(result).toEqual([{ id: 1, name: "Tee" }])
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/store/products")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test_key")
  })

  it("throws a PrintfulError on non-2xx with error payload", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 }),
    )
    await expect(listSyncProducts()).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("nope"),
    })
  })

  it("getShippingRates POSTs recipient + items and returns rates", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ result: [{ id: "STANDARD", rate: "4.99", name: "Flat" }] }),
      ),
    )
    const rates = await getShippingRates({
      recipient: { country_code: "US", zip: "78701" } as any,
      items: [{ variant_id: 1, quantity: 1 }],
    })
    expect(rates[0].id).toBe("STANDARD")
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/shipping/rates")
    expect(init?.method).toBe("POST")
  })

  it("verifyWebhookSignature rejects bad HMAC", () => {
    expect(verifyWebhookSignature("payload", "wrong-sig")).toBe(false)
  })

  it("verifyWebhookSignature accepts correct HMAC", () => {
    const { createHmac } = require("node:crypto")
    const secret = "test_secret"
    const payload = "test_payload"
    const sig = createHmac("sha256", secret).update(payload).digest("hex")
    expect(verifyWebhookSignature(payload, sig)).toBe(true)
  })

  it("throws helpful error when PRINTFUL_API_KEY is not set", async () => {
    delete process.env.PRINTFUL_API_KEY
    await expect(listSyncProducts()).rejects.toThrow("PRINTFUL_API_KEY not set")
  })

  it("throws helpful error when PRINTFUL_WEBHOOK_SECRET is not set", () => {
    delete process.env.PRINTFUL_WEBHOOK_SECRET
    expect(() => verifyWebhookSignature("payload", "sig")).toThrow(
      "PRINTFUL_WEBHOOK_SECRET not set",
    )
  })

  it("getSyncProduct calls GET /store/products/:id", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            sync_product: { id: 42, name: "Hat" },
            sync_variants: [],
          },
        }),
      ),
    )
    const detail = await getSyncProduct(42)
    expect(detail.sync_product.name).toBe("Hat")
    const [url] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/store/products/42")
  })

  it("createOrder POSTs to /orders?confirm=false", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { id: 99, external_id: "ext-1", status: "draft" },
        }),
      ),
    )
    const order = await createOrder({
      external_id: "ext-1",
      recipient: {
        name: "John",
        address1: "123 Main St",
        city: "Austin",
        state_code: "TX",
        country_code: "US",
        zip: "78701",
        email: "john@example.com",
      },
      items: [{ sync_variant_id: 1, quantity: 1 }],
    })
    expect(order.id).toBe(99)
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/orders?confirm=false")
    expect(init?.method).toBe("POST")
  })

  it("confirmOrder POSTs to /orders/:id/confirm", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { id: 99, status: "pending" } })),
    )
    await confirmOrder(99)
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/orders/99/confirm")
    expect(init?.method).toBe("POST")
  })

  it("cancelOrder DELETEs /orders/:id", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { id: 99, status: "canceled" } })),
    )
    await cancelOrder(99)
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/orders/99")
    expect(init?.method).toBe("DELETE")
  })
})
