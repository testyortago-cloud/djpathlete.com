import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock dependencies ──────────────────────────────────────────────────────────

vi.mock("@/lib/db/shop-orders", () => ({
  getOrderByStripeSessionId: vi.fn(),
  updateOrderStatus: vi.fn(),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { handleShopOrderCheckout } from "@/lib/shop/webhooks"
import { getOrderByStripeSessionId, updateOrderStatus } from "@/lib/db/shop-orders"
import type Stripe from "stripe"

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    payment_intent: "pi_test_456",
    metadata: { type: "shop_order" },
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

const baseOrder = {
  id: "order-uuid",
  order_number: "DJP-001",
  status: "pending" as const,
  stripe_session_id: "cs_test_123",
  stripe_payment_intent_id: null,
  customer_email: "buyer@example.com",
  customer_name: "Test Buyer",
  total_cents: 3000,
  subtotal_cents: 2500,
  shipping_cents: 500,
  refund_amount_cents: null,
  user_id: null,
  notes: null,
  printful_order_id: null,
  tracking_number: null,
  tracking_url: null,
  carrier: null,
  items: [],
  shipping_address: {},
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
  shipped_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleShopOrderCheckout", () => {
  it("logs an error and does not throw when no matching order is found", async () => {
    vi.mocked(getOrderByStripeSessionId).mockResolvedValue(null)

    await expect(handleShopOrderCheckout(makeSession())).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No order found for stripe_session_id=cs_test_123"),
    )
    expect(updateOrderStatus).not.toHaveBeenCalled()
  })

  it("is a no-op when the order is already paid (idempotency)", async () => {
    vi.mocked(getOrderByStripeSessionId).mockResolvedValue({
      ...baseOrder,
      status: "paid",
    })

    await expect(handleShopOrderCheckout(makeSession())).resolves.toBeUndefined()

    expect(updateOrderStatus).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it("is a no-op for any non-pending status (e.g. confirmed)", async () => {
    vi.mocked(getOrderByStripeSessionId).mockResolvedValue({
      ...baseOrder,
      status: "confirmed",
    })

    await expect(handleShopOrderCheckout(makeSession())).resolves.toBeUndefined()

    expect(updateOrderStatus).not.toHaveBeenCalled()
  })

  it("transitions pending order to paid and stores stripe_payment_intent_id (string)", async () => {
    vi.mocked(getOrderByStripeSessionId).mockResolvedValue({ ...baseOrder, status: "pending" })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ...baseOrder, status: "paid", stripe_payment_intent_id: "pi_test_456" })

    await handleShopOrderCheckout(makeSession({ payment_intent: "pi_test_456" }))

    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "paid", {
      stripe_payment_intent_id: "pi_test_456",
    })
  })

  it("extracts payment_intent id when it is an expanded object", async () => {
    vi.mocked(getOrderByStripeSessionId).mockResolvedValue({ ...baseOrder, status: "pending" })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ...baseOrder, status: "paid", stripe_payment_intent_id: "pi_expanded" })

    const expandedSession = makeSession({
      payment_intent: { id: "pi_expanded" } as unknown as Stripe.PaymentIntent,
    })

    await handleShopOrderCheckout(expandedSession)

    expect(updateOrderStatus).toHaveBeenCalledWith("order-uuid", "paid", {
      stripe_payment_intent_id: "pi_expanded",
    })
  })

  it("returns early without throwing when session has no id", async () => {
    const session = makeSession({ id: undefined as unknown as string })

    await expect(handleShopOrderCheckout(session)).resolves.toBeUndefined()

    expect(getOrderByStripeSessionId).not.toHaveBeenCalled()
    expect(updateOrderStatus).not.toHaveBeenCalled()
  })
})
