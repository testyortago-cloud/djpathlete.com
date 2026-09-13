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

// ── Mock the signed-URL minter sendFreeDownloadEmail imports dynamically ──────

vi.mock("@/lib/shop/downloads", () => ({
  generateSignedDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/file.pdf"),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  sendOrderReceivedEmail,
  sendOrderConfirmedEmail,
  sendOrderShippedEmail,
  sendOrderCanceledEmail,
  sendOrderRefundedEmail,
  sendFreeDownloadEmail,
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

// ── sendFreeDownloadEmail ─────────────────────────────────────────────────────
//
// This one is different from the five above, and deliberately so. Its only
// caller — app/api/shop/leads/route.ts — wraps it in try/catch and answers the
// visitor 502 when it throws. The download links ARE the thing the visitor was
// promised in exchange for their address, so "we could not send it" has to
// reach them; the other five are notifications about an order that already
// exists, where a failed send is logged and the order still stands.

type ShopProductFile = import("@/types/database").ShopProductFile
/** Exactly the fields sendFreeDownloadEmail reads off a product file row. */
type ReadFields = Pick<ShopProductFile, "display_name" | "storage_path">

const freeDownloadInput = {
  to: "lead@example.com",
  productName: "Speed Primer",
  // A checked partial, not an `as unknown as ShopProductFile[]`: the sender
  // reads only these two fields, and the `satisfies` keeps tsc verifying that
  // both still exist on the real row type with these value types. A blanket
  // cast through `unknown` would let a renamed or retyped column through.
  files: [
    { display_name: "primer.pdf", storage_path: "shop/primer.pdf" } satisfies ReadFields,
  ] as ShopProductFile[],
  ttlSeconds: 900,
}

describe("sendFreeDownloadEmail", () => {
  it("sends the links when the key is set and the provider accepts", async () => {
    // Presence control for the two absence assertions below.
    await expect(sendFreeDownloadEmail(freeDownloadInput)).resolves.toBeUndefined()

    expect(resend.emails.send).toHaveBeenCalledOnce()
    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "lead@example.com",
        subject: expect.stringContaining("Speed Primer"),
      }),
    )
  })

  it("rejects when the provider rejects the send", async () => {
    // MUTANT: drop the `if (error) throw` and go back to a bare
    // `await resend.emails.send(...)`. The route then answers 200 and the
    // visitor waits for a download email Resend never accepted. This is the
    // half of the fix that is live in production, which HAS the key.
    vi.mocked(resend.emails.send).mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "bad" },
    } as unknown as Awaited<ReturnType<typeof resend.emails.send>>)

    await expect(sendFreeDownloadEmail(freeDownloadInput)).rejects.toThrow(/bad/)
  })

  it("rejects naming RESEND_API_KEY, and mints no links, when the key is unset", async () => {
    // MUTANT: restore `warnMissingKey(...); return` — the route answers 200
    // and the visitor is told their download is on its way.
    //
    // Reachable in a real process only if lib/resend.ts stopped building its
    // client eagerly: `new Resend(process.env.RESEND_API_KEY!)` throws at
    // import when the key is unset, so today this branch is a test-only
    // guard. It is still the honest answer for the branch to give.
    vi.stubEnv("RESEND_API_KEY", "")

    await expect(sendFreeDownloadEmail(freeDownloadInput)).rejects.toThrow(/RESEND_API_KEY/)
    expect(resend.emails.send).not.toHaveBeenCalled()
  })
})
