import { describe, it, expect, vi, beforeEach } from "vitest"

const createSessionMock = vi.fn()
const getUserByIdMock = vi.fn()
const resolveBillingUserIdMock = vi.fn()

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: (...a: unknown[]) => createSessionMock(...a) } }
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
    id === PAYER ? { id: PAYER, email: "payer@example.com" } : { id: TRAINEE, email: "trainee@example.com" },
  )
})

describe("createPackCheckoutSession — household billing payer", () => {
  it("addresses checkout to the PAYER when one is set", async () => {
    resolveBillingUserIdMock.mockResolvedValue(PAYER)
    await createPackCheckoutSession(opts)
    // Stripe locks a provided customer_email, so this IS who the receipt
    // reaches — the whole point of the fix.
    expect(createSessionMock.mock.calls[0][0].customer_email).toBe("payer@example.com")
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
    expect(createSessionMock.mock.calls[0][0].customer_email).toBe("trainee@example.com")
  })

  it("still pins SOME email when the payer lookup throws — never leaves it blank to Link autofill", async () => {
    resolveBillingUserIdMock.mockRejectedValue(new Error("db down"))
    await createPackCheckoutSession(opts)
    // A blank customer_email lets Stripe Link autofill whoever is signed in on
    // the browser opening the link — historically the coach's own account.
    expect(createSessionMock.mock.calls[0][0].customer_email).toBeUndefined()
    expect(createSessionMock.mock.calls[0][0].metadata.clientUserId).toBe(TRAINEE)
  })
})
