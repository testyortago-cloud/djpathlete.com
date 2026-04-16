import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock dependencies ──────────────────────────────────────────────────────────

vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_test" }),
    },
  },
}))

vi.mock("@/lib/printful", () => ({
  createOrder: vi.fn(),
  confirmOrder: vi.fn(),
  cancelOrder: vi.fn(),
}))

vi.mock("@/lib/db/shop-orders", () => ({
  getOrderById: vi.fn(),
  updateOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { confirmOrderToPrintful, cancelShopOrder, refundShopOrder } from "@/lib/shop/fulfillment"
import { stripe } from "@/lib/stripe"
import { createOrder as createPrintfulOrder, confirmOrder, cancelOrder } from "@/lib/printful"
import { getOrderById, updateOrder, updateOrderStatus } from "@/lib/db/shop-orders"

// ── Test helpers ──────────────────────────────────────────────────────────────

const baseOrder = {
  id: "order-uuid",
  order_number: "DJP-001",
  customer_email: "test@example.com",
  customer_name: "Jane Doe",
  status: "paid" as const,
  stripe_payment_intent_id: "pi_test",
  stripe_session_id: "cs_test",
  printful_order_id: null,
  total_cents: 5000,
  subtotal_cents: 4000,
  shipping_cents: 1000,
  refund_amount_cents: null,
  notes: null,
  user_id: null,
  tracking_number: null,
  tracking_url: null,
  carrier: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
  shipped_at: null,
  items: [
    {
      variant_id: "var-uuid",
      product_id: "prod-uuid",
      name: "DJP Tee",
      variant_name: "M / White",
      thumbnail_url: "",
      quantity: 2,
      unit_price_cents: 2000,
      printful_variant_id: 12345,
    },
  ],
  shipping_address: {
    name: "Jane Doe",
    email: "test@example.com",
    phone: null,
    line1: "123 Main St",
    line2: null,
    city: "Austin",
    state: "TX",
    country: "US",
    postal_code: "78701",
  },
}

const mockPrintfulDraft = { id: 9999, external_id: "DJP-001", status: "draft" }

beforeEach(() => {
  vi.clearAllMocks()
})

// ── confirmOrderToPrintful ────────────────────────────────────────────────────

describe("confirmOrderToPrintful", () => {
  it("throws when order not found", async () => {
    vi.mocked(getOrderById).mockResolvedValue(null)
    await expect(confirmOrderToPrintful("missing-id")).rejects.toThrow("Order not found")
  })

  it("throws when status is not paid", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "confirmed" })
    await expect(confirmOrderToPrintful("order-uuid")).rejects.toThrow(
      "Cannot confirm order in status confirmed",
    )
  })

  it("throws when status is not paid or draft (e.g. confirmed)", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "confirmed" })
    await expect(confirmOrderToPrintful("order-uuid")).rejects.toThrow(
      "Cannot confirm order in status confirmed",
    )
  })

  it("skips createOrder and only calls confirmPrintfulOrder when status is draft with printful_order_id", async () => {
    const draftOrder = { ...baseOrder, status: "draft" as const, printful_order_id: 9999 }
    vi.mocked(getOrderById).mockResolvedValue(draftOrder)
    vi.mocked(confirmOrder).mockResolvedValue({ ...mockPrintfulDraft, status: "confirmed" } as never)
    const confirmedOrder = { ...draftOrder, status: "confirmed" as const }
    vi.mocked(updateOrderStatus).mockResolvedValue(confirmedOrder)

    const result = await confirmOrderToPrintful("order-uuid")

    // createPrintfulOrder must NOT be called — we already have a draft
    expect(createPrintfulOrder).not.toHaveBeenCalled()

    // confirmOrder should be called with the existing printful_order_id
    expect(confirmOrder).toHaveBeenCalledWith(9999)

    // DB should transition to confirmed
    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "confirmed")

    expect(result.status).toBe("confirmed")
  })

  it("throws when status is draft but printful_order_id is missing", async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...baseOrder,
      status: "draft" as const,
      printful_order_id: null,
    })

    await expect(confirmOrderToPrintful("order-uuid")).rejects.toThrow(
      /draft status but has no printful_order_id/,
    )

    expect(createPrintfulOrder).not.toHaveBeenCalled()
    expect(confirmOrder).not.toHaveBeenCalled()
  })

  it("creates Printful draft, updates DB to draft, confirms, then sets status confirmed", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "paid" })
    vi.mocked(createPrintfulOrder).mockResolvedValue(mockPrintfulDraft as never)
    vi.mocked(confirmOrder).mockResolvedValue({ ...mockPrintfulDraft, status: "confirmed" } as never)
    const confirmedOrder = { ...baseOrder, status: "confirmed" as const, printful_order_id: 9999 }
    vi.mocked(updateOrder).mockResolvedValue(confirmedOrder)
    vi.mocked(updateOrderStatus).mockResolvedValue(confirmedOrder)

    const result = await confirmOrderToPrintful("order-uuid")

    // Printful draft was created
    expect(createPrintfulOrder).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: "DJP-001" }),
    )

    // DB updated with draft status and printful_order_id
    expect(updateOrder).toHaveBeenCalledWith("order-uuid", {
      status: "draft",
      printful_order_id: 9999,
    })

    // Printful draft confirmed
    expect(confirmOrder).toHaveBeenCalledWith(9999)

    // Final status set to confirmed
    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "confirmed")

    expect(result.status).toBe("confirmed")
  })
})

// ── cancelShopOrder ───────────────────────────────────────────────────────────

describe("cancelShopOrder", () => {
  it("throws when order not found", async () => {
    vi.mocked(getOrderById).mockResolvedValue(null)
    await expect(cancelShopOrder("missing")).rejects.toThrow("Order not found")
  })

  it("throws when status is confirmed (not cancelable)", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "confirmed" })
    await expect(cancelShopOrder("order-uuid")).rejects.toThrow(
      "Cannot cancel order in status confirmed",
    )
  })

  it("throws when status is shipped", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "shipped" })
    await expect(cancelShopOrder("order-uuid")).rejects.toThrow(
      "Cannot cancel order in status shipped",
    )
  })

  it("refunds Stripe in full and cancels Printful draft when printful_order_id exists", async () => {
    const orderWithPrintful = { ...baseOrder, status: "draft" as const, printful_order_id: 9999 }
    vi.mocked(getOrderById).mockResolvedValue(orderWithPrintful)
    vi.mocked(cancelOrder).mockResolvedValue({ ...mockPrintfulDraft, status: "canceled" } as never)
    vi.mocked(updateOrderStatus).mockResolvedValue({
      ...orderWithPrintful,
      status: "canceled",
      refund_amount_cents: 5000,
    })

    await cancelShopOrder("order-uuid")

    expect(cancelOrder).toHaveBeenCalledWith(9999)
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_test" })
    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "canceled", {
      refund_amount_cents: 5000,
    })
  })

  it("skips Printful cancel when no printful_order_id", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "paid" })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ...baseOrder, status: "canceled" })

    await cancelShopOrder("order-uuid")

    expect(cancelOrder).not.toHaveBeenCalled()
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_test" })
  })

  it("proceeds with Stripe refund even when Printful cancel throws", async () => {
    const orderWithPrintful = { ...baseOrder, status: "draft" as const, printful_order_id: 9999 }
    vi.mocked(getOrderById).mockResolvedValue(orderWithPrintful)
    vi.mocked(cancelOrder).mockRejectedValue(new Error("Printful API error"))
    vi.mocked(updateOrderStatus).mockResolvedValue({
      ...orderWithPrintful,
      status: "canceled",
      refund_amount_cents: 5000,
    })

    // Should not throw despite Printful failure
    await expect(cancelShopOrder("order-uuid")).resolves.toBeDefined()

    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_test" })
    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "canceled", {
      refund_amount_cents: 5000,
    })
  })

  it("transitions DB to canceled with failure note then rethrows when Stripe refund fails", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "paid" })
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(new Error("card_declined"))
    vi.mocked(updateOrderStatus).mockResolvedValue({ ...baseOrder, status: "canceled" })

    await expect(cancelShopOrder("order-uuid")).rejects.toThrow("card_declined")

    // DB must still transition to canceled
    expect(updateOrderStatus).toHaveBeenCalledWith(
      "order-uuid",
      "canceled",
      expect.objectContaining({
        notes: expect.stringContaining("Stripe refund FAILED"),
      }),
    )

    // The note must include the payment_intent id and not include refund_amount_cents
    const call = vi.mocked(updateOrderStatus).mock.calls[0]
    expect(call[2]).not.toHaveProperty("refund_amount_cents")
    expect(call[2]?.notes).toMatch(/manual refund required for payment_intent pi_test/)
  })

  it("allows canceling a paid order (no Printful draft)", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "paid" })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ...baseOrder, status: "canceled" })

    await cancelShopOrder("order-uuid")

    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "canceled", {
      refund_amount_cents: 5000,
    })
  })
})

// ── refundShopOrder ───────────────────────────────────────────────────────────

describe("refundShopOrder", () => {
  it("throws when order not found", async () => {
    vi.mocked(getOrderById).mockResolvedValue(null)
    await expect(refundShopOrder("missing", 1000)).rejects.toThrow("Order not found")
  })

  it("throws when no stripe_payment_intent_id", async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...baseOrder,
      stripe_payment_intent_id: null,
    })
    await expect(refundShopOrder("order-uuid", 1000)).rejects.toThrow("No Stripe payment intent")
  })

  it("throws when amount exceeds total", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder })
    await expect(refundShopOrder("order-uuid", 6000)).rejects.toThrow("Refund exceeds total")
  })

  it("partial refund: updates refund_amount_cents, status unchanged", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "confirmed" as const })
    vi.mocked(updateOrder).mockResolvedValue({
      ...baseOrder,
      status: "confirmed",
      refund_amount_cents: 1000,
    })

    const result = await refundShopOrder("order-uuid", 1000)

    expect(stripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: "pi_test",
      amount: 1000,
      reason: undefined,
    })
    expect(updateOrder).toHaveBeenCalledWith(
      "order-uuid",
      expect.objectContaining({ refund_amount_cents: 1000 }),
    )
    expect(updateOrderStatus).not.toHaveBeenCalled()
    expect(result.status).toBe("confirmed")
  })

  it("full refund: status transitions to refunded", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "confirmed" as const })
    vi.mocked(updateOrderStatus).mockResolvedValue({
      ...baseOrder,
      status: "refunded",
      refund_amount_cents: 5000,
    })

    const result = await refundShopOrder("order-uuid", 5000)

    expect(stripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: "pi_test",
      amount: 5000,
      reason: undefined,
    })
    expect(updateOrderStatus).toHaveBeenCalledWith(
      "order-uuid",
      "refunded",
      expect.objectContaining({ refund_amount_cents: 5000 }),
    )
    expect(updateOrder).not.toHaveBeenCalled()
    expect(result.status).toBe("refunded")
  })

  it("full refund with reason: passes requested_by_customer to Stripe", async () => {
    vi.mocked(getOrderById).mockResolvedValue({ ...baseOrder, status: "confirmed" as const })
    vi.mocked(updateOrderStatus).mockResolvedValue({
      ...baseOrder,
      status: "refunded",
      refund_amount_cents: 5000,
    })

    await refundShopOrder("order-uuid", 5000, "Customer requested cancellation")

    expect(stripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: "pi_test",
      amount: 5000,
      reason: "requested_by_customer",
    })
  })

  it("accumulates partial refund on top of existing refund_amount_cents", async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...baseOrder,
      status: "confirmed" as const,
      refund_amount_cents: 1000,
    })
    vi.mocked(updateOrder).mockResolvedValue({
      ...baseOrder,
      status: "confirmed",
      refund_amount_cents: 2500,
    })

    await refundShopOrder("order-uuid", 1500)

    expect(updateOrder).toHaveBeenCalledWith(
      "order-uuid",
      expect.objectContaining({ refund_amount_cents: 2500 }),
    )
  })
})
