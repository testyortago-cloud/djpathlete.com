import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mock Resend ───────────────────────────────────────────────────────────────

vi.mock("@/lib/resend", () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ id: "test", error: null }),
    },
  },
  FROM_EMAIL: "test@example.com",
}))

// ── Mock react-dom/server ─────────────────────────────────────────────────────

vi.mock("react-dom/server", () => ({
  renderToStaticMarkup: vi.fn().mockReturnValue("<html>mock</html>"),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  sendOrderReceivedEmail,
  sendOrderConfirmedEmail,
  sendOrderShippedEmail,
  sendOrderCanceledEmail,
  sendOrderRefundedEmail,
} from "@/lib/shop/emails"
import { resend } from "@/lib/resend"

// ── Test helpers ──────────────────────────────────────────────────────────────

const baseOrder = {
  id: "order-uuid",
  order_number: "DJP-001",
  customer_email: "customer@example.com",
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
      quantity: 1,
      unit_price_cents: 4000,
      printful_variant_id: 12345,
    },
  ],
  shipping_address: {
    name: "Jane Doe",
    email: "customer@example.com",
    phone: null,
    line1: "123 Main St",
    line2: null,
    city: "Austin",
    state: "TX",
    country: "US",
    postal_code: "78701",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  // Ensure API key is set by default
  vi.stubEnv("RESEND_API_KEY", "test-key")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendOrderReceivedEmail", () => {
  it("calls resend.emails.send when RESEND_API_KEY is set", async () => {
    await sendOrderReceivedEmail(baseOrder)

    expect(resend.emails.send).toHaveBeenCalledOnce()
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DJP-001"),
      }),
    )
  })

  it("does not throw and warns when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(sendOrderReceivedEmail(baseOrder)).resolves.toBeUndefined()

    expect(resend.emails.send).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY"))
  })
})

describe("sendOrderConfirmedEmail", () => {
  it("calls resend.emails.send when RESEND_API_KEY is set", async () => {
    await sendOrderConfirmedEmail(baseOrder)

    expect(resend.emails.send).toHaveBeenCalledOnce()
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DJP-001"),
      }),
    )
  })

  it("does not throw and warns when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(sendOrderConfirmedEmail(baseOrder)).resolves.toBeUndefined()

    expect(resend.emails.send).not.toHaveBeenCalled()
  })
})

describe("sendOrderShippedEmail", () => {
  it("calls resend.emails.send when RESEND_API_KEY is set", async () => {
    const shippedOrder = {
      ...baseOrder,
      status: "shipped" as const,
      tracking_number: "1Z999AA10123456784",
      tracking_url: "https://track.example.com/1Z999AA10123456784",
      carrier: "UPS",
    }

    await sendOrderShippedEmail(shippedOrder)

    expect(resend.emails.send).toHaveBeenCalledOnce()
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DJP-001"),
      }),
    )
  })

  it("does not throw and warns when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(sendOrderShippedEmail(baseOrder)).resolves.toBeUndefined()

    expect(resend.emails.send).not.toHaveBeenCalled()
  })
})

describe("sendOrderCanceledEmail", () => {
  it("calls resend.emails.send when RESEND_API_KEY is set", async () => {
    const canceledOrder = {
      ...baseOrder,
      status: "canceled" as const,
      refund_amount_cents: 5000,
    }

    await sendOrderCanceledEmail(canceledOrder)

    expect(resend.emails.send).toHaveBeenCalledOnce()
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DJP-001"),
      }),
    )
  })

  it("does not throw and warns when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(sendOrderCanceledEmail(baseOrder)).resolves.toBeUndefined()

    expect(resend.emails.send).not.toHaveBeenCalled()
  })
})

describe("sendOrderRefundedEmail", () => {
  it("calls resend.emails.send when RESEND_API_KEY is set", async () => {
    const refundedOrder = {
      ...baseOrder,
      status: "refunded" as const,
      refund_amount_cents: 5000,
    }

    await sendOrderRefundedEmail(refundedOrder)

    expect(resend.emails.send).toHaveBeenCalledOnce()
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("DJP-001"),
      }),
    )
  })

  it("does not throw and warns when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(sendOrderRefundedEmail(baseOrder)).resolves.toBeUndefined()

    expect(resend.emails.send).not.toHaveBeenCalled()
  })
})
