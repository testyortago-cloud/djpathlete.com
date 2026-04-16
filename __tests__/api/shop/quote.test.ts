import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/shop-variants", () => ({
  getVariantsByIds: vi.fn(),
}))

vi.mock("@/lib/printful", () => {
  class PrintfulError extends Error {
    status: number
    code?: number | string
    constructor(status: number, message: string, code?: number | string) {
      super(message)
      this.status = status
      this.code = code
    }
  }
  return {
    PrintfulError,
    getShippingRates: vi.fn(),
  }
})

import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getShippingRates, PrintfulError } from "@/lib/printful"

const mockGetVariantsByIds = vi.mocked(getVariantsByIds)
const mockGetShippingRates = vi.mocked(getShippingRates)

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// Valid fixtures
const VALID_VARIANT_ID = "00000000-0000-0000-0000-000000000001"

const VALID_BODY = {
  items: [{ variant_id: VALID_VARIANT_ID, quantity: 2 }],
  address: {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: null,
    line1: "123 Main St",
    line2: null,
    city: "Tampa",
    state: "FL",
    country: "US",
    postal_code: "33601",
  },
}

const AVAILABLE_VARIANT = {
  id: VALID_VARIANT_ID,
  product_id: "prod-1",
  printful_sync_variant_id: 999,
  printful_variant_id: 4321,
  sku: "SKU-1",
  name: "Tee / Blue / M",
  size: "M",
  color: "Blue",
  retail_price_cents: 2500,
  printful_cost_cents: 1200,
  mockup_url: "https://example.com/mockup.png",
  mockup_url_override: null,
  is_available: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const SHIPPING_RATES = [
  { id: "STANDARD", name: "Standard Shipping", rate: "5.99", currency: "USD" },
  { id: "EXPRESS", name: "Express Shipping", rate: "12.99", currency: "USD" },
]

async function makeRequest(body: unknown) {
  const { POST } = await import("@/app/api/shop/quote/route")
  return POST(new Request("http://localhost/api/shop/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }))
}

describe("POST /api/shop/quote", () => {
  it("returns 400 for invalid body (missing address)", async () => {
    const res = await makeRequest({ items: [{ variant_id: VALID_VARIANT_ID, quantity: 1 }] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it("returns 400 for invalid body (empty items array)", async () => {
    const res = await makeRequest({ ...VALID_BODY, items: [] })
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid body (malformed variant_id)", async () => {
    const res = await makeRequest({
      ...VALID_BODY,
      items: [{ variant_id: "not-a-uuid", quantity: 1 }],
    })
    expect(res.status).toBe(400)
  })

  it("returns 409 when a variant is not found", async () => {
    mockGetVariantsByIds.mockResolvedValue([])

    const res = await makeRequest(VALID_BODY)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/unavailable/i)
  })

  it("returns 409 when a variant is found but is_available is false", async () => {
    mockGetVariantsByIds.mockResolvedValue([{ ...AVAILABLE_VARIANT, is_available: false }])

    const res = await makeRequest(VALID_BODY)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/unavailable/i)
  })

  it("returns 422 when Printful returns empty rates", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockResolvedValue([])

    const res = await makeRequest(VALID_BODY)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/no shipping options/i)
  })

  it("returns 502 when Printful throws a PrintfulError", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockRejectedValue(new PrintfulError(500, "Printful internal error"))

    const res = await makeRequest(VALID_BODY)
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toBe("Printful internal error")
  })

  it("re-throws non-PrintfulError errors (default 500 behavior)", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockRejectedValue(new Error("Unexpected failure"))

    await expect(makeRequest(VALID_BODY)).rejects.toThrow("Unexpected failure")
  })

  it("happy path: returns cheapest rate and correct totals", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockResolvedValue(SHIPPING_RATES)

    const res = await makeRequest(VALID_BODY)
    expect(res.status).toBe(200)
    const json = await res.json()

    // Standard ($5.99) is cheaper than Express ($12.99)
    expect(json.shipping_cents).toBe(599)
    expect(json.shipping_label).toBe("Standard Shipping")
    // 2 * 2500 = 5000
    expect(json.subtotal_cents).toBe(5000)
    // 5000 + 599 = 5599
    expect(json.total_cents).toBe(5599)
  })

  it("happy path: picks cheapest when only one rate", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockResolvedValue([
      { id: "ECONOMY", name: "Economy Shipping", rate: "3.50", currency: "USD" },
    ])

    const res = await makeRequest(VALID_BODY)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.shipping_cents).toBe(350)
    expect(json.shipping_label).toBe("Economy Shipping")
  })

  it("passes the correct Printful recipient fields (state_code, country_code, zip)", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockResolvedValue(SHIPPING_RATES)

    await makeRequest(VALID_BODY)

    expect(mockGetShippingRates).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: expect.objectContaining({
          state_code: "FL",
          country_code: "US",
          zip: "33601",
          address1: "123 Main St",
        }),
      }),
    )
  })

  it("passes printful_variant_id (catalog id) not internal id to getShippingRates", async () => {
    mockGetVariantsByIds.mockResolvedValue([AVAILABLE_VARIANT])
    mockGetShippingRates.mockResolvedValue(SHIPPING_RATES)

    await makeRequest(VALID_BODY)

    expect(mockGetShippingRates).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ variant_id: AVAILABLE_VARIANT.printful_variant_id }),
        ]),
      }),
    )
  })
})
