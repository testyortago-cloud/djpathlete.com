import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const getOrCreateStripeCustomer = vi.fn()
const resolveBillingUserId = vi.fn()
const getUserById = vi.fn()

vi.mock("stripe", () => ({
  default: class { checkout = { sessions: { create } }; customers = { create: vi.fn() } },
}))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId }))
vi.mock("@/lib/db/users", () => ({ getUserById, updateUser: vi.fn() }))

describe("createPackCheckoutSession card capture", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    create.mockResolvedValue({ id: "cs_1", url: "https://pay" })
    resolveBillingUserId.mockResolvedValue("payer-1")
    getUserById.mockResolvedValue({ id: "payer-1", email: "payer@x.com", stripe_customer_id: "cus_payer" })
  })

  it("attaches the PAYER's customer and asks Stripe to save the card", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: "u1", name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null, autoRenew: true,
    })
    const arg = create.mock.calls[0][0]
    expect(arg.customer).toBe("cus_payer")
    expect(arg.customer_email).toBeUndefined()
    expect(arg.payment_intent_data.setup_future_usage).toBe("off_session")
    expect(arg.metadata.autoRenew).toBe("true")
  })

  it("keeps customer_email and saves NO card for an account-less payer", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: "u1", name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
      billToEmail: "parent@x.com",
    })
    const arg = create.mock.calls[0][0]
    expect(arg.customer_email).toBe("parent@x.com")
    expect(arg.customer).toBeUndefined()
    expect(arg.payment_intent_data?.setup_future_usage).toBeUndefined()
  })

  it("never sends customer and customer_email together", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: "u1", name: "x", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
    })
    const arg = create.mock.calls[0][0]
    expect(Boolean(arg.customer) && Boolean(arg.customer_email)).toBe(false)
  })
})
