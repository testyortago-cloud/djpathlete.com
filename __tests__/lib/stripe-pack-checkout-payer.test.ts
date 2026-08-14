import { describe, it, expect, vi, beforeEach } from "vitest"

const createSessionMock = vi.fn()
const getUserByIdMock = vi.fn()
const resolveBillingUserIdMock = vi.fn()

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: (...a: unknown[]) => createSessionMock(...a) } }
    // getOrCreateStripeCustomer's best-effort email reconciliation (I4)
    // touches these when reusing a stored customer id — resolve retrieve to
    // a live customer whose email already matches so reconciliation is a
    // silent no-op here (an unresolved vi.fn() would return undefined and
    // throw inside the reconciliation's `"deleted" in customer` check).
    customers = {
      create: vi.fn(),
      // No `deleted` key at all — that's how a LIVE Stripe customer actually
      // looks (the field only appears, as true, once the customer is
      // deleted). Including `deleted: false` here would make the source's
      // `"deleted" in customer` narrowing treat it as deleted, since `in`
      // tests key presence, not truthiness.
      retrieve: vi.fn(async (id: string) => ({ id, email: "payer@example.com" })),
      update: vi.fn(),
    }
  },
}))
vi.mock("@/lib/db/users", () => ({
  getUserById: (...a: unknown[]) => getUserByIdMock(...a),
  updateUser: vi.fn(),
}))
vi.mock("@/lib/services/billing-payer", () => ({
  resolveBillingUserId: (...a: unknown[]) => resolveBillingUserIdMock(...a),
}))

import { createPackCheckoutSession } from "@/lib/stripe"

const TRAINEE = "trainee-1"
const PAYER = "payer-1"

const opts = {
  clientUserId: TRAINEE,
  name: "10× 1-on-1",
  sessionType: "1-on-1",
  credits: 10,
  priceCents: 50000,
  validityDays: null,
  productId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_URL = "https://www.darrenjpaul.com"
  createSessionMock.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" })
  getUserByIdMock.mockImplementation(async (id: string) =>
    id === PAYER
      ? { id: PAYER, email: "payer@example.com", stripe_customer_id: "cus_payer" }
      : { id: TRAINEE, email: "trainee@example.com", stripe_customer_id: "cus_trainee" },
  )
})

describe("createPackCheckoutSession — household billing payer", () => {
  it("addresses checkout to the PAYER when one is set", async () => {
    resolveBillingUserIdMock.mockResolvedValue(PAYER)
    await createPackCheckoutSession(opts)
    // A Stripe Customer, not a bare email, is what pins the addressee now —
    // Stripe rejects customer + customer_email together, and attaching the
    // Customer object (vs. a bare pinned email) is also what lets
    // getOrCreateStripeCustomer keep the receipt email in sync going forward.
    // Distinguishing cus_payer from cus_trainee is the whole point: this must
    // fail if the trainee's identity leaks in instead of the payer's.
    expect(createSessionMock.mock.calls[0][0].customer).toBe("cus_payer")
    expect(createSessionMock.mock.calls[0][0].customer_email).toBeUndefined()
  })

  it("still credits the pack to the TRAINEE, not the payer", async () => {
    resolveBillingUserIdMock.mockResolvedValue(PAYER)
    await createPackCheckoutSession(opts)
    // The webhook reads metadata.clientUserId to decide whose pack this is.
    // If the payer resolution ever leaked into metadata, the payer would
    // receive the sessions — a far worse bug than the wrong receipt email.
    expect(createSessionMock.mock.calls[0][0].metadata.clientUserId).toBe(TRAINEE)
  })

  it("falls back to the client's own email when no payer is set", async () => {
    resolveBillingUserIdMock.mockResolvedValue(TRAINEE)
    await createPackCheckoutSession(opts)
    // "Own email" now means the trainee's own Stripe customer, for the same
    // reason as above — not cus_payer, so this still discriminates identity.
    expect(createSessionMock.mock.calls[0][0].customer).toBe("cus_trainee")
  })

  it("leaves customer_email unset when the payer lookup throws, rather than failing the sale", async () => {
    resolveBillingUserIdMock.mockRejectedValue(new Error("db down"))
    await createPackCheckoutSession(opts)
    // Unpinned means Stripe Link may autofill whoever is signed in on the
    // browser opening the link — bad, but strictly better than a 500 that
    // blocks the sale outright.
    expect(createSessionMock.mock.calls[0][0].customer_email).toBeUndefined()
    expect(createSessionMock.mock.calls[0][0].metadata.clientUserId).toBe(TRAINEE)
  })
})

describe("createPackCheckoutSession — explicit bill-to address", () => {
  it("an explicit billToEmail beats a household payer", async () => {
    resolveBillingUserIdMock.mockResolvedValue(PAYER)
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    expect(createSessionMock.mock.calls[0][0].customer_email).toBe("dad@example.com")
  })

  it("an explicit billToEmail beats the client's own email", async () => {
    resolveBillingUserIdMock.mockResolvedValue(TRAINEE)
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    expect(createSessionMock.mock.calls[0][0].customer_email).toBe("dad@example.com")
  })

  it("still credits the TRAINEE when billed to an outside email", async () => {
    resolveBillingUserIdMock.mockResolvedValue(TRAINEE)
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    // The dad has no account. If he ever landed in metadata.clientUserId the
    // webhook would credit the sessions to nobody.
    expect(createSessionMock.mock.calls[0][0].metadata.clientUserId).toBe(TRAINEE)
  })

  it("skips the payer lookup entirely when billToEmail is given", async () => {
    await createPackCheckoutSession({ ...opts, billToEmail: "dad@example.com" })
    // A DB round-trip whose result is discarded is a latency bug on the money path.
    expect(resolveBillingUserIdMock).not.toHaveBeenCalled()
  })

  it("falls back to the payer when billToEmail is null", async () => {
    resolveBillingUserIdMock.mockResolvedValue(PAYER)
    await createPackCheckoutSession({ ...opts, billToEmail: null })
    // The routes pass `?? null`, so null must mean "no override", not "no email".
    expect(createSessionMock.mock.calls[0][0].customer).toBe("cus_payer")
  })
})
