import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/printful", () => ({
  verifyWebhookSignature: vi.fn(),
}))

vi.mock("@/lib/db/shop-orders", () => ({
  getOrderByPrintfulOrderId: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrder: vi.fn(),
}))

vi.mock("@/lib/shop/emails", () => ({
  sendOrderShippedEmail: vi.fn(),
}))

import { verifyWebhookSignature } from "@/lib/printful"
import {
  getOrderByPrintfulOrderId,
  updateOrderStatus,
  updateOrder,
} from "@/lib/db/shop-orders"
import { sendOrderShippedEmail } from "@/lib/shop/emails"

const mockVerify = vi.mocked(verifyWebhookSignature)
const mockGetOrderByPrintfulOrderId = vi.mocked(getOrderByPrintfulOrderId)
const mockUpdateOrderStatus = vi.mocked(updateOrderStatus)
const mockUpdateOrder = vi.mocked(updateOrder)
const mockSendOrderShippedEmail = vi.mocked(sendOrderShippedEmail)

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PRINTFUL_ORDER_ID = 12345
const ORDER_ID = "00000000-0000-0000-0000-000000000001"

const BASE_ORDER = {
  id: ORDER_ID,
  order_number: "DJP-20260101-001",
  user_id: null,
  customer_email: "customer@example.com",
  customer_name: "Test Customer",
  shipping_address: {
    name: "Test Customer",
    email: "customer@example.com",
    phone: null,
    line1: "123 Main St",
    line2: null,
    city: "Tampa",
    state: "FL",
    country: "US",
    postal_code: "33601",
  },
  stripe_session_id: "cs_test_abc",
  stripe_payment_intent_id: "pi_test_abc",
  printful_order_id: PRINTFUL_ORDER_ID,
  status: "confirmed" as const,
  items: [],
  subtotal_cents: 2500,
  shipping_cents: 599,
  total_cents: 3099,
  notes: null,
  tracking_number: null,
  tracking_url: null,
  carrier: null,
  refund_amount_cents: null,
  shipped_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const SHIPMENT_DATA = {
  carrier: "USPS",
  service: "Priority Mail",
  tracking_number: "9400111899223823515517",
  tracking_url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223823515517",
  shipped_at: 1704067200, // 2024-01-01T00:00:00Z unix
}

function makeRequest(body: unknown, signature = "valid-sig") {
  return new Request("http://localhost/api/shop/webhooks/printful", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pf-webhook-signature": signature,
    },
    body: JSON.stringify(body),
  })
}

function makePackageShippedEvent(orderId = PRINTFUL_ORDER_ID) {
  return {
    type: "package_shipped",
    created: 1704067200,
    retries: 0,
    store: 1,
    data: {
      order: {
        id: orderId,
        external_id: ORDER_ID,
        status: "fulfilled",
        shipping: "STANDARD",
      },
      shipment: SHIPMENT_DATA,
    },
  }
}

function makeOrderUpdatedEvent(status: string, orderId = PRINTFUL_ORDER_ID) {
  return {
    type: "order_updated",
    created: 1704067200,
    retries: 0,
    store: 1,
    data: {
      order: {
        id: orderId,
        external_id: ORDER_ID,
        status,
        shipping: "STANDARD",
      },
    },
  }
}

function makeOrderFailedEvent(orderId = PRINTFUL_ORDER_ID) {
  return {
    type: "order_failed",
    created: 1704067200,
    retries: 0,
    store: 1,
    data: {
      order: {
        id: orderId,
        external_id: ORDER_ID,
        status: "failed",
        shipping: "STANDARD",
      },
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/shop/webhooks/printful", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Default: signature valid, order found
    mockVerify.mockReturnValue(true)
    mockGetOrderByPrintfulOrderId.mockResolvedValue(BASE_ORDER)
    mockUpdateOrderStatus.mockResolvedValue({ ...BASE_ORDER, status: "shipped" })
    mockUpdateOrder.mockResolvedValue(BASE_ORDER)
    mockSendOrderShippedEmail.mockResolvedValue(undefined)
  })

  // ── Signature verification ────────────────────────────────────────────────

  it("returns 401 when x-pf-webhook-signature header is missing", async () => {
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const req = new Request("http://localhost/api/shop/webhooks/printful", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makePackageShippedEvent()),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it("returns 401 when signature is invalid", async () => {
    mockVerify.mockReturnValue(false)
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const res = await POST(makeRequest(makePackageShippedEvent()))
    expect(res.status).toBe(401)
    // Signature is verified BEFORE any DB lookup
    expect(mockGetOrderByPrintfulOrderId).not.toHaveBeenCalled()
  })

  // ── Unknown event type ────────────────────────────────────────────────────

  it("returns 200 no-op for unknown event type", async () => {
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const unknownEvent = {
      type: "product_synced",
      created: 1704067200,
      retries: 0,
      store: 1,
      data: {
        order: { id: PRINTFUL_ORDER_ID, external_id: ORDER_ID, status: "draft", shipping: "STANDARD" },
      },
    }
    const res = await POST(makeRequest(unknownEvent))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
    expect(mockUpdateOrder).not.toHaveBeenCalled()
    expect(mockSendOrderShippedEmail).not.toHaveBeenCalled()
  })

  // ── Order not found — silent no-op ────────────────────────────────────────

  it("returns 200 silently when order is not found by printful_order_id", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue(null)
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const res = await POST(makeRequest(makePackageShippedEvent()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
  })

  // ── package_shipped ───────────────────────────────────────────────────────

  it("package_shipped: updates status to shipped with tracking fields", async () => {
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const res = await POST(makeRequest(makePackageShippedEvent()))
    expect(res.status).toBe(200)
    expect(mockUpdateOrderStatus).toHaveBeenCalledWith(ORDER_ID, "shipped", {
      tracking_number: SHIPMENT_DATA.tracking_number,
      tracking_url: SHIPMENT_DATA.tracking_url,
      carrier: SHIPMENT_DATA.carrier,
      shipped_at: new Date(SHIPMENT_DATA.shipped_at * 1000).toISOString(),
    })
  })

  it("package_shipped: sends shipped email after updating status", async () => {
    const shippedOrder = { ...BASE_ORDER, status: "shipped" as const }
    mockUpdateOrderStatus.mockResolvedValue(shippedOrder)
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makePackageShippedEvent()))
    expect(mockSendOrderShippedEmail).toHaveBeenCalledWith(shippedOrder)
  })

  it("package_shipped: no-op (idempotent) when order already has status shipped", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, status: "shipped" })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const res = await POST(makeRequest(makePackageShippedEvent()))
    expect(res.status).toBe(200)
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
    expect(mockSendOrderShippedEmail).not.toHaveBeenCalled()
  })

  it("package_shipped: no-op when order is already refunded", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, status: "refunded" })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makePackageShippedEvent()))
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
    expect(mockSendOrderShippedEmail).not.toHaveBeenCalled()
  })

  it("package_shipped: no-op when order is already canceled", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, status: "canceled" })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makePackageShippedEvent()))
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
    expect(mockSendOrderShippedEmail).not.toHaveBeenCalled()
  })

  // ── order_updated ─────────────────────────────────────────────────────────

  it("order_updated: advances to in_production when inprocess and current status is confirmed", async () => {
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const res = await POST(makeRequest(makeOrderUpdatedEvent("inprocess")))
    expect(res.status).toBe(200)
    expect(mockUpdateOrderStatus).toHaveBeenCalledWith(ORDER_ID, "in_production")
  })

  it("order_updated: advances to in_production when inprocess and current status is paid", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, status: "paid" })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makeOrderUpdatedEvent("inprocess")))
    expect(mockUpdateOrderStatus).toHaveBeenCalledWith(ORDER_ID, "in_production")
  })

  it("order_updated: no-op when inprocess but order already in_production", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, status: "in_production" })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makeOrderUpdatedEvent("inprocess")))
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
  })

  it("order_updated: no-op for other printful statuses (e.g. draft)", async () => {
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makeOrderUpdatedEvent("draft")))
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
  })

  // ── order_failed ──────────────────────────────────────────────────────────

  it("order_failed: appends log entry to notes, does not change status", async () => {
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    const res = await POST(makeRequest(makeOrderFailedEvent()))
    expect(res.status).toBe(200)
    expect(mockUpdateOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({
        notes: expect.stringContaining("[printful] order_failed event at"),
      }),
    )
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled()
  })

  it("order_failed: preserves existing notes when appending", async () => {
    const existingNotes = "Admin note: confirmed manually"
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, notes: existingNotes })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makeOrderFailedEvent()))
    expect(mockUpdateOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({
        notes: expect.stringContaining(existingNotes),
      }),
    )
    expect(mockUpdateOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({
        notes: expect.stringContaining("[printful] order_failed event at"),
      }),
    )
  })

  it("order_failed: handles null notes gracefully (no leading newline)", async () => {
    mockGetOrderByPrintfulOrderId.mockResolvedValue({ ...BASE_ORDER, notes: null })
    const { POST } = await import("@/app/api/shop/webhooks/printful/route")
    await POST(makeRequest(makeOrderFailedEvent()))
    const callArg = mockUpdateOrder.mock.calls[0][1]
    expect(callArg.notes).not.toMatch(/^\n/)
  })
})
