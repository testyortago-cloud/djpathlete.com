import { describe, it, expect, vi, beforeEach } from "vitest"

const retrieveMock = vi.fn()
const expireMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()
const updateClientPackageMock = vi.fn()

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        retrieve: (...a: unknown[]) => retrieveMock(...a),
        expire: (...a: unknown[]) => expireMock(...a),
      },
    },
  },
  createPackCheckoutSession: (...a: unknown[]) => createPackCheckoutSessionMock(...a),
}))
vi.mock("@/lib/db/client-packages", () => ({
  updateClientPackage: (...a: unknown[]) => updateClientPackageMock(...a),
}))

import { resolvePackPaymentLink, changePackBillTo } from "@/lib/services/pack-payment-link"
import type { ClientPackage } from "@/types/database"

const pack = {
  id: "pack-1",
  client_user_id: "client-1",
  product_id: null,
  session_type: "Performance training",
  credits_total: 10,
  price_cents: 150000,
  payment_method: "stripe",
  payment_status: "pending",
  stripe_session_id: "cs_old",
  bill_to_email: "dad@example.com",
} as unknown as ClientPackage

beforeEach(() => {
  vi.clearAllMocks()
  createPackCheckoutSessionMock.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/cs_new" })
  expireMock.mockResolvedValue({})
})

describe("resolvePackPaymentLink", () => {
  it("returns the still-open session untouched", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    const r = await resolvePackPaymentLink(pack)
    expect(r).toEqual({ ok: true, url: "https://stripe.test/cs_old", refreshed: false })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("re-mints an expired session WITH the pack's bill-to address", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    const r = await resolvePackPaymentLink(pack)
    expect(r).toEqual({ ok: true, url: "https://stripe.test/cs_new", refreshed: true })
    // The regression this whole column exists to prevent: a re-minted link
    // silently reverting to the trainee's inbox.
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBe("dad@example.com")
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", { stripe_session_id: "cs_new" })
  })

  it("re-mints with a null address when the pack has none", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await resolvePackPaymentLink({ ...pack, bill_to_email: null } as ClientPackage)
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBeNull()
  })

  it("refuses to repoint a completed session", async () => {
    retrieveMock.mockResolvedValue({ status: "complete" })
    const r = await resolvePackPaymentLink(pack)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s on a Stripe error instead of minting a competing session", async () => {
    retrieveMock.mockRejectedValue(new Error("stripe down"))
    const r = await resolvePackPaymentLink(pack)
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("409s for a pack that is not awaiting a card payment", async () => {
    const r = await resolvePackPaymentLink({ ...pack, payment_status: "paid" } as ClientPackage)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(retrieveMock).not.toHaveBeenCalled()
  })

  it("mints a first link for a pack that has no session yet", async () => {
    const r = await resolvePackPaymentLink({ ...pack, stripe_session_id: null } as ClientPackage)
    expect(r).toMatchObject({ ok: true, refreshed: true })
    expect(retrieveMock).not.toHaveBeenCalled()
  })
})

describe("changePackBillTo", () => {
  const unaddressed = { ...pack, bill_to_email: null } as ClientPackage

  it("expires the open session and mints one addressed to the new payer", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    const r = await changePackBillTo(unaddressed, "dad@example.com")
    expect(expireMock).toHaveBeenCalledWith("cs_old")
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBe("dad@example.com")
    expect(r).toMatchObject({ ok: true, refreshed: true })
  })

  it("persists the new address alongside the new session id", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    await changePackBillTo(unaddressed, "dad@example.com")
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", {
      bill_to_email: "dad@example.com",
      stripe_session_id: "cs_new",
      bill_to_emailed_at: null,
    })
  })

  it("refuses when the session is already paid", async () => {
    retrieveMock.mockResolvedValue({ status: "complete" })
    const r = await changePackBillTo(unaddressed, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(expireMock).not.toHaveBeenCalled()
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s rather than guessing when Stripe is unreachable", async () => {
    retrieveMock.mockRejectedValue(new Error("stripe down"))
    const r = await changePackBillTo(unaddressed, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("502s when the old session cannot be expired, so two live links can't exist", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    expireMock.mockRejectedValue(new Error("nope"))
    const r = await changePackBillTo(unaddressed, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 502 })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
    // The detach may have landed, but the address must NOT have changed.
    for (const [, patch] of updateClientPackageMock.mock.calls) {
      expect(patch).not.toHaveProperty("bill_to_email")
    }
  })

  it("detaches the pack from the old session BEFORE expiring it", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    const order: string[] = []
    updateClientPackageMock.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      order.push(patch.stripe_session_id === null ? "detach" : "repoint")
    })
    expireMock.mockImplementation(async () => {
      order.push("expire")
    })

    await changePackBillTo(unaddressed, "dad@example.com")

    // Expiring fires checkout.session.expired, and handleSessionPackExpired
    // cancels whatever pending pack still points at that session id. Expiring
    // while attached loses the pack to a webhook race.
    expect(order).toEqual(["detach", "expire", "repoint"])
  })

  it("clears the address back to null", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await changePackBillTo(pack, null)
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBeNull()
    expect(updateClientPackageMock.mock.calls[0][1].bill_to_email).toBeNull()
  })

  it("409s for a pack that is not awaiting a card payment", async () => {
    const r = await changePackBillTo({ ...pack, payment_status: "paid" } as ClientPackage, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
})
