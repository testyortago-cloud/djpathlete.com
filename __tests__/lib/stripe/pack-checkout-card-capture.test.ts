import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
const customersCreate = vi.fn()
const resolveBillingUserId = vi.fn()
const getUserById = vi.fn()
const cardOnFileEnabled = vi.fn()

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create } }
    // getOrCreateStripeCustomer's email reconciliation (I4) calls retrieve
    // whenever reusing a stored customer id — resolve it to a live customer
    // whose email already matches so reconciliation is a silent no-op (an
    // unresolved vi.fn() would return undefined and throw inside the
    // reconciliation's `"deleted" in customer` check).
    customers = {
      create: customersCreate,
      // No `deleted` key at all — that's how a LIVE Stripe customer actually
      // looks (the field only appears, as true, once the customer is
      // deleted). Including `deleted: false` would make the source's
      // `"deleted" in customer` narrowing treat it as deleted, since `in`
      // tests key presence, not truthiness.
      retrieve: vi.fn(async (id: string) => ({
        id,
        email: id === "cus_payer" ? "payer@x.com" : "trainee@x.com",
      })),
      update: vi.fn(),
    }
  },
}))
vi.mock("@/lib/services/billing-payer", () => ({ resolveBillingUserId }))
vi.mock("@/lib/db/users", () => ({ getUserById, updateUser: vi.fn() }))
vi.mock("@/lib/packs/flags", () => ({ cardOnFileEnabled: (...a: unknown[]) => cardOnFileEnabled(...a) }))

const TRAINEE = "u1"
const PAYER = "payer-1"

beforeEach(() => {
  vi.clearAllMocks()
  create.mockResolvedValue({ id: "cs_1", url: "https://pay" })
  resolveBillingUserId.mockResolvedValue(PAYER)
  // Matches production default (card_on_file_enabled defaults true) so
  // existing tests below keep exercising the autoRenew-driven behavior;
  // the I5 kill-switch test overrides this to false.
  cardOnFileEnabled.mockResolvedValue(true)
  // I1 fix: id-aware, with DISTINCT stripe_customer_id per identity, so a
  // test asserting "cus_payer" genuinely fails if the implementation ever
  // passes the trainee's id instead of the resolved payer's.
  getUserById.mockImplementation(async (id: string) =>
    id === PAYER
      ? { id: PAYER, email: "payer@x.com", stripe_customer_id: "cus_payer" }
      : { id: TRAINEE, email: "trainee@x.com", stripe_customer_id: "cus_trainee" },
  )
})

describe("createPackCheckoutSession card capture", () => {
  it("attaches the PAYER's customer (never the trainee's) and asks Stripe to save the card when consented", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: TRAINEE, name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null, autoRenew: true,
    })
    const arg = create.mock.calls[0][0]
    // Resolution goes through resolveBillingUserId with the TRAINEE id — if
    // the implementation ever swapped in opts.clientUserId directly for
    // getOrCreateStripeCustomer, this call wouldn't happen at all.
    expect(resolveBillingUserId).toHaveBeenCalledWith(TRAINEE)
    expect(arg.customer).toBe("cus_payer")
    expect(arg.customer).not.toBe("cus_trainee")
    expect(arg.customer_email).toBeUndefined()
    expect(arg.payment_intent_data.setup_future_usage).toBe("off_session")
    expect(arg.metadata.autoRenew).toBe("true")
    expect(arg.metadata.billingUserId).toBe(PAYER)
  })

  it("attaches the customer for addressee purposes but does NOT ask Stripe to save the card when autoRenew is unset (I5)", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: TRAINEE, name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
    })
    const arg = create.mock.calls[0][0]
    // Attaching `customer` (the addressee fix) is unconditional...
    expect(arg.customer).toBe("cus_payer")
    // ...but setup_future_usage — the actual "keep this card reusable"
    // instruction to Stripe — requires consent. A client who left the
    // checkbox unchecked must not have their card silently made chargeable
    // off-session, especially since pack links are shareable.
    expect(arg.payment_intent_data).toBeUndefined()
    expect(arg.metadata.autoRenew).toBe("false")
  })

  it("does not ask Stripe to save the card when card_on_file_enabled is off, even with consent (I5 kill switch)", async () => {
    cardOnFileEnabled.mockResolvedValue(false)
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: TRAINEE, name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null, autoRenew: true,
    })
    const arg = create.mock.calls[0][0]
    // The addressee fix (attaching `customer`) is independent of the card-
    // capture kill switch — only setup_future_usage is gated on it.
    expect(arg.customer).toBe("cus_payer")
    expect(arg.payment_intent_data).toBeUndefined()
    // metadata.autoRenew still reflects the checkbox itself — the flag
    // guards CAPTURE, not the recorded consent or later pack arming.
    expect(arg.metadata.autoRenew).toBe("true")
  })

  it("keeps customer_email and saves NO card for an account-less payer", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: TRAINEE, name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
      billToEmail: "parent@x.com",
    })
    const arg = create.mock.calls[0][0]
    expect(arg.customer_email).toBe("parent@x.com")
    expect(arg.customer).toBeUndefined()
    expect(arg.payment_intent_data?.setup_future_usage).toBeUndefined()
    expect(resolveBillingUserId).not.toHaveBeenCalled()
    // No identity was ever resolved for an account-less payer — nothing to stamp.
    expect(arg.metadata.billingUserId).toBe("")
  })

  it("never sends customer and customer_email together", async () => {
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: TRAINEE, name: "x", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null,
    })
    const arg = create.mock.calls[0][0]
    expect(Boolean(arg.customer) && Boolean(arg.customer_email)).toBe(false)
  })

  it("falls back to pinning customer_email when customer creation fails, rather than leaving checkout fully unaddressed (Concern B)", async () => {
    // Force the "no stored id yet" path so getOrCreateStripeCustomer actually
    // reaches stripe.customers.create, then make that call fail.
    getUserById.mockResolvedValue({ id: PAYER, email: "payer@x.com", stripe_customer_id: null })
    customersCreate.mockRejectedValue(new Error("stripe down"))
    const { createPackCheckoutSession } = await import("@/lib/stripe")
    await createPackCheckoutSession({
      clientUserId: TRAINEE, name: "10x training", sessionType: "training",
      credits: 10, priceCents: 75000, validityDays: null, productId: null, autoRenew: true,
    })
    const arg = create.mock.calls[0][0]
    expect(arg.customer).toBeUndefined()
    expect(arg.customer_email).toBe("payer@x.com")
    expect(arg.payment_intent_data).toBeUndefined()
  })
})
