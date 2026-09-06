// Giving a camp its Stripe price instead of refusing to publish it.
//
// The case this exists for is a DUPLICATED camp: the duplicate route copies
// price_dollars and deliberately drops the Stripe ids, so the copy is priced in
// dollars and unsellable. What must never happen is the opposite mistake — the
// server picking a price nobody asked for.

import { describe, expect, it, vi, beforeEach } from "vitest"

const getEventById = vi.fn()
const updateEvent = vi.fn()
const syncEventToStripe = vi.fn()

vi.mock("@/lib/db/events", () => ({
  getEventById: (...a: unknown[]) => getEventById(...a),
  updateEvent: (...a: unknown[]) => updateEvent(...a),
}))
vi.mock("@/lib/stripe", () => ({ syncEventToStripe: (...a: unknown[]) => syncEventToStripe(...a) }))

import { ensureEventPriced } from "@/lib/events/ensure-priced"

const EVENT_ID = "cccccccc-3333-4333-8333-cccccccccccc"
const BUSINESS_ID = "admin-biz"

const camp = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  title: "Summer Camp (copy)",
  price_cents: 44900,
  stripe_product_id: null,
  stripe_price_id: null,
  status: "published",
  ...over,
})

beforeEach(() => {
  getEventById.mockReset().mockResolvedValue(camp())
  updateEvent.mockReset().mockResolvedValue(undefined)
  syncEventToStripe.mockReset().mockResolvedValue({ productId: "prod_1", priceId: "price_1" })
})

describe("ensureEventPriced", () => {
  it("creates and PERSISTS the Stripe product for a priced camp with no price id", async () => {
    const out = await ensureEventPriced(BUSINESS_ID, EVENT_ID)
    expect(out).toEqual({ ok: true, changed: true })
    // MUTANT: swapping the two string arguments — TypeScript cannot catch it.
    expect(getEventById).toHaveBeenCalledWith(BUSINESS_ID, EVENT_ID)
    expect(syncEventToStripe).toHaveBeenCalledTimes(1)
    // MUTANT: dropping the updateEvent call. syncEventToStripe's own doc says the
    // caller owns the write, so a sync whose ids are never stored would create a
    // BRAND NEW Stripe product on every single publish.
    expect(updateEvent).toHaveBeenCalledWith(BUSINESS_ID, EVENT_ID, {
      stripe_product_id: "prod_1",
      stripe_price_id: "price_1",
    })
  })

  it("does nothing at all when the camp already has a price id", async () => {
    getEventById.mockResolvedValue(camp({ stripe_price_id: "price_existing" }))
    const out = await ensureEventPriced(BUSINESS_ID, EVENT_ID)
    expect(out).toEqual({ ok: true, changed: false })
    expect(syncEventToStripe).not.toHaveBeenCalled()
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it("REFUSES to invent a price when the camp has none", async () => {
    // The one decision that is the owner's. A default here would silently charge
    // somebody an amount nobody chose.
    getEventById.mockResolvedValue(camp({ price_cents: null }))
    const out = await ensureEventPriced(BUSINESS_ID, EVENT_ID)
    expect(out).toEqual({ ok: false, reason: "no_price" })
    expect(syncEventToStripe).not.toHaveBeenCalled()
  })

  it("treats a zero price as no price", async () => {
    getEventById.mockResolvedValue(camp({ price_cents: 0 }))
    expect(await ensureEventPriced(BUSINESS_ID, EVENT_ID)).toEqual({ ok: false, reason: "no_price" })
  })

  it("reports a missing camp rather than throwing", async () => {
    getEventById.mockResolvedValue(null)
    expect(await ensureEventPriced(BUSINESS_ID, EVENT_ID)).toEqual({ ok: false, reason: "not_found" })
  })

  it("reports a Stripe failure rather than throwing, and writes nothing", async () => {
    // It runs inside a publish that is about to report on several pages at once;
    // one unreachable Stripe must not take that whole report down.
    syncEventToStripe.mockRejectedValue(new Error("stripe down"))
    const out = await ensureEventPriced(BUSINESS_ID, EVENT_ID)
    expect(out).toEqual({ ok: false, reason: "sync_failed" })
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it("reports a failed read rather than throwing", async () => {
    getEventById.mockRejectedValue(new Error("db down"))
    expect(await ensureEventPriced(BUSINESS_ID, EVENT_ID)).toEqual({ ok: false, reason: "not_found" })
  })
})
