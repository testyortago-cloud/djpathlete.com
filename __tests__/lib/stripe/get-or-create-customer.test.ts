import { describe, it, expect, vi, beforeEach } from "vitest"

// I4: getOrCreateStripeCustomer must keep the Stripe Customer's email in sync
// with what the caller currently believes is correct. Without this, a client
// who changes their email in-app keeps receiving receipts at the OLD address
// forever — the Stripe Customer object is created once and never touched
// again otherwise. Same wrong-inbox property the original customer_email fix
// eliminated, just relocated to a field nothing was watching.

const customersCreate = vi.fn()
const customersRetrieve = vi.fn()
const customersUpdate = vi.fn()
const getUserById = vi.fn()
const updateUser = vi.fn()

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: vi.fn() } }
    customers = { create: customersCreate, retrieve: customersRetrieve, update: customersUpdate }
  },
}))
vi.mock("@/lib/db/users", () => ({ getUserById, updateUser }))

const USER = "user-1"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getOrCreateStripeCustomer", () => {
  it("creates a new customer when none exists yet", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "new@x.com", stripe_customer_id: null })
    customersCreate.mockResolvedValue({ id: "cus_new" })
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    const id = await getOrCreateStripeCustomer(USER, "new@x.com")
    expect(id).toBe("cus_new")
    expect(customersCreate).toHaveBeenCalledWith(expect.objectContaining({ email: "new@x.com" }))
    expect(updateUser).toHaveBeenCalledWith(USER, { stripe_customer_id: "cus_new" })
  })

  it("pushes the current email to Stripe when the stored customer's copy is stale", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "new@x.com", stripe_customer_id: "cus_existing" })
    customersRetrieve.mockResolvedValue({ id: "cus_existing", email: "old@x.com" })
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    const id = await getOrCreateStripeCustomer(USER, "new@x.com")
    expect(id).toBe("cus_existing")
    expect(customersUpdate).toHaveBeenCalledWith("cus_existing", { email: "new@x.com" })
    expect(customersCreate).not.toHaveBeenCalled()
  })

  it("does not call update when Stripe's email already matches", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "same@x.com", stripe_customer_id: "cus_existing" })
    customersRetrieve.mockResolvedValue({ id: "cus_existing", email: "same@x.com" })
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    await getOrCreateStripeCustomer(USER, "same@x.com")
    expect(customersUpdate).not.toHaveBeenCalled()
  })

  it("does not push an email onto a deleted Stripe customer", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "new@x.com", stripe_customer_id: "cus_gone" })
    customersRetrieve.mockResolvedValue({ id: "cus_gone", deleted: true })
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    const id = await getOrCreateStripeCustomer(USER, "new@x.com")
    expect(id).toBe("cus_gone")
    expect(customersUpdate).not.toHaveBeenCalled()
  })

  it("is best-effort: a reconciliation failure still returns the stored id instead of throwing", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "new@x.com", stripe_customer_id: "cus_existing" })
    customersRetrieve.mockRejectedValue(new Error("stripe down"))
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    await expect(getOrCreateStripeCustomer(USER, "new@x.com")).resolves.toBe("cus_existing")
    expect(customersUpdate).not.toHaveBeenCalled()
  })

  it("is best-effort: an update failure still returns the stored id instead of throwing", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "new@x.com", stripe_customer_id: "cus_existing" })
    customersRetrieve.mockResolvedValue({ id: "cus_existing", email: "old@x.com" })
    customersUpdate.mockRejectedValue(new Error("stripe down"))
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    await expect(getOrCreateStripeCustomer(USER, "new@x.com")).resolves.toBe("cus_existing")
  })

  // NEW-3: some callers (app/api/stripe/checkout/route.ts) pass
  // session.user.email straight from the NextAuth JWT, which can be up to
  // 24h stale under this repo's session lifetime. The function must trust
  // its OWN fresh getUserById read over that argument, or a program checkout
  // could silently revert an email a more recent save-card/pack flow synced.
  it("trusts its own fresh DB read over a stale caller-supplied email when reconciling", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "current@x.com", stripe_customer_id: "cus_existing" })
    // Stripe's copy already matches the DB's CURRENT email.
    customersRetrieve.mockResolvedValue({ id: "cus_existing", email: "current@x.com" })
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    await getOrCreateStripeCustomer(USER, "stale-jwt-cached@x.com")
    // Must NOT push the stale caller-supplied email over the already-current one.
    expect(customersUpdate).not.toHaveBeenCalled()
  })

  it("creates a new customer with its own fresh DB email, not a stale caller argument", async () => {
    getUserById.mockResolvedValue({ id: USER, email: "current@x.com", stripe_customer_id: null })
    customersCreate.mockResolvedValue({ id: "cus_new" })
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe")
    await getOrCreateStripeCustomer(USER, "stale-jwt-cached@x.com")
    expect(customersCreate).toHaveBeenCalledWith(expect.objectContaining({ email: "current@x.com" }))
  })
})
