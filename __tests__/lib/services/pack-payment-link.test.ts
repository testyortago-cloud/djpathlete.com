import { describe, it, expect, vi, beforeEach } from "vitest"

const retrieveMock = vi.fn()
const expireMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()
const updateClientPackageMock = vi.fn()
const acquireMock = vi.fn()
const releaseMock = vi.fn()

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
  updateLeasedPackPaymentLink: (id: string, _token: string, patch: unknown) => updateClientPackageMock(id, patch),
  acquirePackPaymentLinkEdit: (...a: unknown[]) => acquireMock(...a),
  releasePackPaymentLinkEdit: (...a: unknown[]) => releaseMock(...a),
}))

import { resolvePackPaymentLink, changePackBillTo, changePackPrice } from "@/lib/services/pack-payment-link"
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
  vi.resetAllMocks()
  acquireMock.mockImplementation(async (source) => source)
  releaseMock.mockResolvedValue(undefined)
  updateClientPackageMock.mockResolvedValue(pack)
  createPackCheckoutSessionMock.mockResolvedValue({ id: "cs_new", url: "https://stripe.test/cs_new" })
  expireMock.mockResolvedValue({})
})

describe("changePackPrice", () => {
  it("keeps the expiry guard if saving the correction fails after the old checkout expires", async () => {
    retrieveMock.mockResolvedValue({ status: "open" })
    updateClientPackageMock.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(changePackPrice(pack, 75000)).rejects.toThrow("database unavailable")
    expect(releaseMock).not.toHaveBeenCalled()
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })
  it("blocks a competing copy-link request while a price edit waits for Stripe", async () => {
    let leased = false
    acquireMock.mockImplementation(async (source) => {
      if (leased) return null
      leased = true
      return source
    })
    let finishExpiry!: () => void
    let expiryStarted!: () => void
    const started = new Promise<void>((resolve) => {
      expiryStarted = resolve
    })
    retrieveMock.mockResolvedValue({ status: "open" })
    expireMock.mockImplementation(() => {
      expiryStarted()
      return new Promise<void>((resolve) => {
        finishExpiry = resolve
      })
    })
    const edit = changePackPrice(pack, 75000)
    await started
    expect(await resolvePackPaymentLink(pack)).toMatchObject({ ok: false, status: 409 })
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
    finishExpiry()
    expect(await edit).toMatchObject({ ok: true })
    expect(createPackCheckoutSessionMock).toHaveBeenCalledTimes(1)
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })

  it("continues safely when expiry succeeded but its response was lost", async () => {
    retrieveMock.mockResolvedValueOnce({ status: "open" }).mockResolvedValueOnce({ status: "expired" })
    expireMock.mockRejectedValueOnce(new Error("response lost"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: true })
    expect(updateClientPackageMock).not.toHaveBeenCalledWith("pack-1", { stripe_session_id: "cs_old" })
    expect(createPackCheckoutSessionMock).toHaveBeenCalledTimes(1)
  })

  it("keeps payment completion attached if it wins the expiry race", async () => {
    retrieveMock.mockResolvedValueOnce({ status: "open" }).mockResolvedValueOnce({ status: "complete" })
    expireMock.mockRejectedValueOnce(new Error("completed meanwhile"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, status: 409 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("retains the expiry guard until retry when Stripe's result cannot be established", async () => {
    retrieveMock.mockResolvedValueOnce({ status: "open" }).mockRejectedValueOnce(new Error("unreachable"))
    expireMock.mockRejectedValueOnce(new Error("response lost"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, retainLock: true })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it("uses the fresh leased pack instead of a stale pre-edit snapshot", async () => {
    acquireMock.mockResolvedValue({
      ...pack,
      bill_to_email: "new-payer@example.com",
      stripe_session_id: "cs_latest",
      price_cents: 100000,
    })
    retrieveMock.mockResolvedValue({ status: "expired" })
    expect(await changePackPrice(pack, 75000)).toMatchObject({ previousPriceCents: 100000 })
    expect(retrieveMock).toHaveBeenCalledWith("cs_latest")
    expect(createPackCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ billToEmail: "new-payer@example.com" }),
    )
  })

  it("replaces the old link at the corrected price without changing credits or payer", async () => {
    retrieveMock.mockResolvedValue({ status: "open" })
    const result = await changePackPrice({ ...pack, credits_used: 8, auto_renew: true }, 75000)
    expect(result).toMatchObject({ ok: true, url: "https://stripe.test/cs_new" })
    expect(expireMock).toHaveBeenCalledWith("cs_old")
    expect(createPackCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        priceCents: 75000,
        credits: 10,
        billToEmail: "dad@example.com",
        autoRenew: true,
      }),
    )
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", {
      price_cents: 75000,
      stripe_session_id: null,
      bill_to_emailed_at: null,
    })
    for (const [, patch] of updateClientPackageMock.mock.calls) {
      expect(patch).not.toHaveProperty("credits_used")
      expect(patch).not.toHaveProperty("credits_total")
      expect(patch).not.toHaveProperty("status")
    }
    expect(expireMock.mock.invocationCallOrder[0]).toBeLessThan(updateClientPackageMock.mock.invocationCallOrder[0])
    expect(expireMock.mock.invocationCallOrder[0]).toBeLessThan(
      createPackCheckoutSessionMock.mock.invocationCallOrder[0],
    )
  })

  it.each(["paid", "refunded", "not_required"])("rejects %s packs", async (payment_status) => {
    expect(await changePackPrice({ ...pack, payment_status } as ClientPackage, 75000)).toMatchObject({
      ok: false,
      status: 409,
    })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, NaN, Infinity, 100000000])("rejects invalid cents %s", async (price) => {
    expect(await changePackPrice(pack, price)).toMatchObject({ ok: false, status: 400 })
    expect(retrieveMock).not.toHaveBeenCalled()
  })

  it("rejects an already-completed checkout even before its webhook arrives", async () => {
    retrieveMock.mockResolvedValue({ status: "complete" })
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, status: 409 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
  })

  it("does not edit the price or create a link when Stripe cannot be checked", async () => {
    retrieveMock.mockRejectedValue(new Error("Stripe unavailable"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, status: 502 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("keeps the old session association if expiry fails and Stripe confirms it is still open", async () => {
    retrieveMock.mockResolvedValue({ status: "open" })
    expireMock.mockRejectedValueOnce(new Error("checkout completed meanwhile"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, status: 502 })
    expect(updateClientPackageMock).not.toHaveBeenCalled()
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("replaces an expired checkout without attempting to expire it again", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: true })
    expect(expireMock).not.toHaveBeenCalled()
  })

  it("changes an unpaid offline pack without contacting Stripe", async () => {
    expect(await changePackPrice({ ...pack, payment_method: "cash" } as ClientPackage, 75000)).toMatchObject({
      ok: true,
    })
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", { price_cents: 75000 })
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(createPackCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it("leaves a saved correction retryable if checkout creation fails", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    createPackCheckoutSessionMock.mockRejectedValueOnce(new Error("Stripe unavailable"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, status: 502, priceSaved: true })
    expect(updateClientPackageMock).toHaveBeenLastCalledWith("pack-1", {
      price_cents: 75000,
      stripe_session_id: null,
      bill_to_emailed_at: null,
    })
  })

  it("expires a replacement link that could not be associated with the pack", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    updateClientPackageMock.mockResolvedValueOnce(pack).mockRejectedValueOnce(new Error("database unavailable"))
    expect(await changePackPrice(pack, 75000)).toMatchObject({ ok: false, priceSaved: true })
    expect(expireMock).toHaveBeenCalledWith("cs_new")
  })
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

  // I3: consent lives on the pack (set at pending-pack creation) — a re-mint
  // must carry it forward. Without this, an expired-then-re-minted link
  // silently produces autoRenew: "false" in Stripe metadata and the pack
  // never arms, even though the client already consented.
  it("carries auto_renew forward from the pack on re-mint", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await resolvePackPaymentLink({ ...pack, auto_renew: true } as ClientPackage)
    expect(createPackCheckoutSessionMock.mock.calls[0][0].autoRenew).toBe(true)
  })

  it("carries auto_renew: false forward just as faithfully", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await resolvePackPaymentLink({ ...pack, auto_renew: false } as ClientPackage)
    expect(createPackCheckoutSessionMock.mock.calls[0][0].autoRenew).toBe(false)
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

  it("detaches the expired checkout before minting so a failed replacement cannot cancel the pack", async () => {
    retrieveMock.mockResolvedValue({ status: "open" })
    createPackCheckoutSessionMock.mockRejectedValueOnce(new Error("Stripe unavailable"))
    await expect(changePackBillTo(unaddressed, "dad@example.com")).rejects.toThrow("Stripe unavailable")
    expect(updateClientPackageMock).toHaveBeenCalledWith("pack-1", {
      bill_to_email: "dad@example.com",
      stripe_session_id: null,
      bill_to_emailed_at: null,
    })
    expect(expireMock.mock.invocationCallOrder[0]).toBeLessThan(updateClientPackageMock.mock.invocationCallOrder[0])
    expect(updateClientPackageMock.mock.invocationCallOrder[0]).toBeLessThan(
      createPackCheckoutSessionMock.mock.invocationCallOrder[0],
    )
  })

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
      stripe_session_id: null,
      bill_to_emailed_at: null,
    })
    expect(updateClientPackageMock).toHaveBeenLastCalledWith("pack-1", { stripe_session_id: "cs_new" })
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
    // A still-open old link must retain its original addressee.
    for (const [, patch] of updateClientPackageMock.mock.calls) {
      expect(patch).not.toHaveProperty("bill_to_email")
    }
  })

  it("keeps the old association until expiry is confirmed while holding the edit lease", async () => {
    retrieveMock.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_old" })
    const order: string[] = []
    updateClientPackageMock.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      order.push(patch.stripe_session_id === null ? "detach" : "repoint")
    })
    expireMock.mockImplementation(async () => {
      order.push("expire")
    })

    await changePackBillTo(unaddressed, "dad@example.com")

    expect(order).toEqual(["expire", "detach", "repoint"])
    expect(acquireMock).toHaveBeenCalled()
    expect(releaseMock).toHaveBeenCalled()
  })

  it("clears the address back to null", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await changePackBillTo(pack, null)
    expect(createPackCheckoutSessionMock.mock.calls[0][0].billToEmail).toBeNull()
    expect(updateClientPackageMock.mock.calls[0][1].bill_to_email).toBeNull()
  })

  // I3: a bill-to change also re-mints via checkoutOptsFor — must not
  // silently disarm auto_renew as a side effect of re-addressing the link.
  it("carries auto_renew forward when the bill-to address changes", async () => {
    retrieveMock.mockResolvedValue({ status: "expired" })
    await changePackBillTo({ ...pack, auto_renew: true } as ClientPackage, "dad@example.com")
    expect(createPackCheckoutSessionMock.mock.calls[0][0].autoRenew).toBe(true)
  })

  it("409s for a pack that is not awaiting a card payment", async () => {
    const r = await changePackBillTo({ ...pack, payment_status: "paid" } as ClientPackage, "dad@example.com")
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
})
