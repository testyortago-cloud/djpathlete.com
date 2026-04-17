import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/shop-variants", () => ({
  getVariantsByIds: vi.fn(),
}))

vi.mock("@/lib/db/shop-products", () => ({
  getProductById: vi.fn(),
}))

vi.mock("@/lib/db/shop-orders", () => ({
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
}))

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getProductById } from "@/lib/db/shop-products"
import { createOrder, updateOrder } from "@/lib/db/shop-orders"
import { stripe } from "@/lib/stripe"
import { auth } from "@/lib/auth"

const mockGetVariantsByIds = vi.mocked(getVariantsByIds)
const mockGetProductById = vi.mocked(getProductById)
const mockCreateOrder = vi.mocked(createOrder)
const mockUpdateOrder = vi.mocked(updateOrder)
const mockStripeSessionCreate = vi.mocked(stripe.checkout.sessions.create)
const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VARIANT_ID = "00000000-0000-0000-0000-000000000001"
const PRODUCT_ID = "00000000-0000-0000-0000-000000000002"
const ORDER_ID = "00000000-0000-0000-0000-000000000003"

const VALID_ADDRESS = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  line1: "123 Main St",
  line2: null,
  city: "Tampa",
  state: "FL",
  country: "US",
  postal_code: "33601",
}

const VALID_BODY = {
  items: [{ variant_id: VARIANT_ID, quantity: 2 }],
  address: VALID_ADDRESS,
  shipping_cents: 599,
}

const AVAILABLE_VARIANT = {
  id: VARIANT_ID,
  product_id: PRODUCT_ID,
  printful_sync_variant_id: 999,
  printful_variant_id: 4321,
  sku: "SKU-1",
  name: "Blue / M",
  size: "M",
  color: "Blue",
  retail_price_cents: 2500,
  printful_cost_cents: 1200,
  mockup_url: "https://example.com/mockup.png",
  mockup_urls: ["https://example.com/mockup.png"],
  mockup_url_override: null,
  is_available: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const ACTIVE_PRODUCT = {
  id: PRODUCT_ID,
  printful_sync_id: 42,
  slug: "cool-tee",
  name: "Cool Tee",
  description: "A great tee",
  thumbnail_url: "https://example.com/thumb.png",
  thumbnail_url_override: null,
  is_active: true,
  is_featured: false,
  sort_order: 0,
  last_synced_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  product_type: "pod" as const,
  affiliate_url: null,
  affiliate_asin: null,
  affiliate_price_cents: null,
  digital_access_days: null,
  digital_signed_url_ttl_seconds: 3600,
  digital_max_downloads: null,
  digital_is_free: false,
}

const CREATED_ORDER = {
  id: ORDER_ID,
  order_number: "DJP-20260101-001",
  user_id: null,
  customer_email: "jane@example.com",
  customer_name: "Jane Doe",
  shipping_address: VALID_ADDRESS,
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  printful_order_id: null,
  status: "pending" as const,
  items: [],
  subtotal_cents: 5000,
  shipping_cents: 599,
  total_cents: 5599,
  notes: null,
  tracking_number: null,
  tracking_url: null,
  carrier: null,
  refund_amount_cents: null,
  shipped_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const STRIPE_SESSION = {
  id: "cs_test_abc123",
  url: "https://checkout.stripe.com/pay/cs_test_abc123",
}

// ─── Helper ──────────────────────────────────────────────────────────────────

async function makeRequest(body: unknown) {
  const { POST } = await import("@/app/api/shop/checkout/route")
  return POST(
    new Request("http://localhost/api/shop/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/shop/checkout", () => {
  describe("body validation", () => {
    it("returns 400 for missing address", async () => {
      const res = await makeRequest({ items: [{ variant_id: VARIANT_ID, quantity: 1 }] })
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBeDefined()
    })

    it("returns 400 for empty items array", async () => {
      const res = await makeRequest({ ...VALID_BODY, items: [] })
      expect(res.status).toBe(400)
    })

    it("returns 400 for malformed variant_id", async () => {
      const res = await makeRequest({
        ...VALID_BODY,
        items: [{ variant_id: "not-a-uuid", quantity: 1 }],
      })
      expect(res.status).toBe(400)
    })

    it("returns 400 for missing shipping_cents", async () => {
      const { shipping_cents: _, ...bodyWithoutShipping } = VALID_BODY
      const res = await makeRequest(bodyWithoutShipping)
      expect(res.status).toBe(400)
    })

    it("returns 400 for negative shipping_cents", async () => {
      const res = await makeRequest({ ...VALID_BODY, shipping_cents: -1 })
      expect(res.status).toBe(400)
    })
  })

  describe("availability re-validation (409)", () => {
    it("returns 409 when variant is not found", async () => {
      mockAuth.mockResolvedValue(null)
      mockGetVariantsByIds.mockResolvedValue([])

      const res = await makeRequest(VALID_BODY)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toMatch(/unavailable/i)
    })

    it("returns 409 when variant is_available is false", async () => {
      mockAuth.mockResolvedValue(null)
      mockGetVariantsByIds.mockResolvedValue([{ ...AVAILABLE_VARIANT, is_available: false }])
      mockGetProductById.mockResolvedValue(ACTIVE_PRODUCT)

      const res = await makeRequest(VALID_BODY)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toMatch(/unavailable/i)
    })

    it("returns 409 when product is_active is false", async () => {
      mockAuth.mockResolvedValue(null)
      mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
      mockGetProductById.mockResolvedValue({ ...ACTIVE_PRODUCT, is_active: false })

      const res = await makeRequest(VALID_BODY)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toMatch(/unavailable/i)
    })

    it("returns 409 when product is not found", async () => {
      mockAuth.mockResolvedValue(null)
      mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
      mockGetProductById.mockResolvedValue(null)

      const res = await makeRequest(VALID_BODY)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toMatch(/unavailable/i)
    })
  })

  describe("successful checkout flow", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue(null)
      mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
      mockGetProductById.mockResolvedValue(ACTIVE_PRODUCT)
      mockCreateOrder.mockResolvedValue(CREATED_ORDER)
      mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION as any)
      mockUpdateOrder.mockResolvedValue({ ...CREATED_ORDER, stripe_session_id: STRIPE_SESSION.id })
    })

    it("returns 200 with url and order_number", async () => {
      const res = await makeRequest(VALID_BODY)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.url).toBe(STRIPE_SESSION.url)
      expect(json.order_number).toBe(CREATED_ORDER.order_number)
    })

    it("creates draft order with status pending", async () => {
      await makeRequest(VALID_BODY)
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "pending",
          customer_email: VALID_ADDRESS.email,
          customer_name: VALID_ADDRESS.name,
        }),
      )
    })

    it("creates draft order with correct subtotal, shipping, and total", async () => {
      await makeRequest(VALID_BODY)
      // 2 items × 2500 = 5000 subtotal; 599 shipping; 5599 total
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          subtotal_cents: 5000,
          shipping_cents: 599,
          total_cents: 5599,
        }),
      )
    })

    it("builds correct line items including shipping in Stripe session", async () => {
      await makeRequest(VALID_BODY)
      expect(mockStripeSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "payment",
          customer_email: VALID_ADDRESS.email,
          line_items: expect.arrayContaining([
            expect.objectContaining({
              price_data: expect.objectContaining({
                unit_amount: 2500,
                currency: "usd",
              }),
              quantity: 2,
            }),
            expect.objectContaining({
              price_data: expect.objectContaining({
                product_data: { name: "Shipping" },
                unit_amount: 599,
              }),
              quantity: 1,
            }),
          ]),
        }),
      )
    })

    it("omits shipping line item when shipping_cents is 0", async () => {
      await makeRequest({ ...VALID_BODY, shipping_cents: 0 })
      const call = mockStripeSessionCreate.mock.calls[0][0] as { line_items: unknown[] }
      const shippingLine = call.line_items.find(
        (li: any) => li.price_data?.product_data?.name === "Shipping",
      )
      expect(shippingLine).toBeUndefined()
    })

    it("includes correct metadata with type shop_order", async () => {
      await makeRequest(VALID_BODY)
      expect(mockStripeSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            type: "shop_order",
            order_id: ORDER_ID,
            order_number: CREATED_ORDER.order_number,
          }),
        }),
      )
    })

    it("sets correct success_url and cancel_url", async () => {
      await makeRequest(VALID_BODY)
      expect(mockStripeSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          success_url: expect.stringContaining(
            `/shop/orders/${CREATED_ORDER.order_number}/thank-you`,
          ),
          cancel_url: expect.stringContaining("/shop/cart"),
        }),
      )
    })

    it("stores stripe_session_id on order after session creation", async () => {
      await makeRequest(VALID_BODY)
      expect(mockUpdateOrder).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ stripe_session_id: STRIPE_SESSION.id }),
      )
    })

    it("sets user_id to null for guest (no session)", async () => {
      await makeRequest(VALID_BODY)
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: null }),
      )
    })

    it("sets user_id from session when logged in", async () => {
      mockAuth.mockResolvedValue({
        user: { id: "user-abc", email: "jane@example.com", name: "Jane", role: "client" },
        expires: "2099-01-01",
      } as any)

      await makeRequest(VALID_BODY)
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "user-abc" }),
      )
    })

    it("uses thumbnail_url_override from variant when present", async () => {
      const variantWithOverride = {
        ...AVAILABLE_VARIANT,
        mockup_url_override: "https://example.com/override.png",
      }
      mockGetVariantsByIds.mockResolvedValue([variantWithOverride])

      await makeRequest(VALID_BODY)
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              thumbnail_url: "https://example.com/override.png",
            }),
          ]),
        }),
      )
    })

    it("falls back to product thumbnail_url when no variant overrides", async () => {
      await makeRequest(VALID_BODY)
      // AVAILABLE_VARIANT.mockup_url_override is null → falls through to mockup_url
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              thumbnail_url: AVAILABLE_VARIANT.mockup_url,
            }),
          ]),
        }),
      )
    })
  })
})
