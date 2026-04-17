import { describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/stripe/webhook/route"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/shop/emails", async () => {
  const actual = await vi.importActual<object>("@/lib/shop/emails")
  return {
    ...actual,
    sendDigitalFulfillmentEmail: vi.fn().mockResolvedValue(undefined),
    sendOrderReceivedEmail: vi.fn().mockResolvedValue(undefined),
  }
})
// Use the same pattern as webhook-events.test.ts — mock the lib wrapper, not the Stripe package
vi.mock("@/lib/stripe", () => ({
  verifyWebhookSignature: (body: string) => JSON.parse(body),
  resolveSessionPaymentIntent: vi.fn().mockResolvedValue(null),
}))
// Stub modules used by the broader webhook handler (program/payment flows)
vi.mock("@/lib/db/payments", () => ({
  createPayment: vi.fn(),
  getPaymentByStripeId: vi.fn().mockResolvedValue(null),
  updatePayment: vi.fn(),
}))
vi.mock("@/lib/db/assignments", () => ({
  createAssignment: vi.fn(),
  getAssignmentByUserAndProgram: vi.fn(),
  updateAssignment: vi.fn(),
}))
vi.mock("@/lib/db/week-access", () => ({
  updateWeekAccess: vi.fn(),
  createWeekAccessBulk: vi.fn(),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  createSubscription: vi.fn(),
  getSubscriptionByStripeId: vi.fn(),
  updateSubscriptionByStripeId: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({
  getUserById: vi.fn(),
  getUserByEmail: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/db/client-profiles", () => ({
  getProfileByUserId: vi.fn(),
}))
vi.mock("@/lib/db/programs", () => ({
  getProgramById: vi.fn(),
}))
vi.mock("@/lib/email", () => ({
  sendCoachPurchaseNotification: vi.fn(),
  sendEventSignupConfirmedEmail: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({
  ghlCreateContact: vi.fn(),
  ghlTriggerWorkflow: vi.fn(),
}))
vi.mock("@/lib/db/event-signups", () => ({
  confirmSignup: vi.fn(),
  cancelSignup: vi.fn(),
  getSignupById: vi.fn(),
  getEventSignupByPaymentIntent: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/db/events", () => ({
  getEventById: vi.fn(),
}))

async function seedPaidDigitalOrder() {
  const supabase = createServiceRoleClient()
  const suffix = Date.now() + "-" + Math.random().toString(36).slice(2, 6)
  const { data: product } = await supabase.from("shop_products").insert({
    slug: `whd-${suffix}`, name: "d", description: "",
    thumbnail_url: "https://x/i.jpg", product_type: "digital",
    digital_signed_url_ttl_seconds: 900, is_active: true,
  }).select("id").single()
  const { data: variant } = await supabase.from("shop_product_variants").insert({
    product_id: product!.id, sku: `d-${suffix}`, name: "Default",
    retail_price_cents: 4900, printful_cost_cents: 0,
    mockup_url: "https://x/m.jpg", mockup_urls: [], is_available: true,
  }).select("id").single()
  const { data: file } = await supabase.from("shop_product_files").insert({
    product_id: product!.id, file_name: "w.pdf", display_name: "W",
    storage_path: "p/w.pdf", file_size_bytes: 1, mime_type: "application/pdf",
  }).select("id").single()
  const { data: order } = await supabase.from("shop_orders").insert({
    order_number: `W-${suffix}`, customer_email: "u@x.com",
    customer_name: "u", shipping_address: {},
    stripe_session_id: `cs_test_${suffix}`,
    status: "pending", subtotal_cents: 4900, shipping_cents: 0, total_cents: 4900,
    items: [{
      variant_id: variant!.id, product_id: product!.id, product_type: "digital",
      name: "d", variant_name: "Default", thumbnail_url: "https://x/m.jpg",
      quantity: 1, unit_price_cents: 4900, printful_variant_id: null,
    }],
  }).select("id, order_number, stripe_session_id").single()
  return { orderId: order!.id, sessionId: order!.stripe_session_id!, fileId: file!.id }
}

describe("stripe webhook — digital-only order", () => {
  it("creates download rows and sets fulfilled_digital", async () => {
    const { orderId, sessionId } = await seedPaidDigitalOrder()
    const event = {
      id: `evt_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          payment_intent: "pi_test",
          metadata: {
            type: "shop_order",
            order_id: orderId,
            contains_digital: "true",
            contains_pod: "false",
          },
        },
      },
    }
    const req = new Request("http://x/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=0,v1=sig" },
      body: JSON.stringify(event),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const supabase = createServiceRoleClient()
    const { data: updated } = await supabase
      .from("shop_orders").select("status").eq("id", orderId).single()
    expect(updated!.status).toBe("fulfilled_digital")
    const { data: downloads } = await supabase
      .from("shop_order_downloads").select("*").eq("order_id", orderId)
    expect(downloads!.length).toBeGreaterThan(0)
  }, 30_000)
})
