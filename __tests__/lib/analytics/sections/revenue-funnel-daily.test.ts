import { describe, it, expect, vi, beforeEach } from "vitest"

const listOrdersInRangeMock = vi.fn()
const listSubscriptionsChangedInRangeMock = vi.fn()
const getSubscriberDeltaInRangeMock = vi.fn()
const getDailyTotalsInRangeMock = vi.fn()

vi.mock("@/lib/db/shop-orders", () => ({
  listOrdersInRange: (...a: unknown[]) => listOrdersInRangeMock(...a),
}))
vi.mock("@/lib/db/subscriptions", () => ({
  listSubscriptionsChangedInRange: (...a: unknown[]) => listSubscriptionsChangedInRangeMock(...a),
}))
vi.mock("@/lib/db/newsletter", () => ({
  getSubscriberDeltaInRange: (...a: unknown[]) => getSubscriberDeltaInRangeMock(...a),
}))
vi.mock("@/lib/db/google-ads-metrics", () => ({
  getDailyTotalsInRange: (...a: unknown[]) => getDailyTotalsInRangeMock(...a),
}))

import { buildDailyRevenueFunnel } from "@/lib/analytics/sections/revenue-funnel-daily"

const referenceDate = new Date("2026-05-07T07:00:00-05:00")

describe("buildDailyRevenueFunnel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listOrdersInRangeMock.mockResolvedValue([])
    listSubscriptionsChangedInRangeMock.mockResolvedValue({ created: 0, cancelled: 0 })
    getSubscriberDeltaInRangeMock.mockResolvedValue({ added: 0, removed: 0 })
    getDailyTotalsInRangeMock.mockResolvedValue({
      cost_micros: 0, conversions: 0, clicks: 0, impressions: 0,
    })
  })

  it("returns null when every metric is zero", async () => {
    expect(await buildDailyRevenueFunnel({ referenceDate })).toBeNull()
  })

  it("aggregates orders + subs + newsletter + ads from yesterday", async () => {
    listOrdersInRangeMock.mockResolvedValue([
      { total_cents: 2500 }, { total_cents: 4500 },
    ])
    listSubscriptionsChangedInRangeMock.mockResolvedValue({ created: 1, cancelled: 0 })
    getSubscriberDeltaInRangeMock.mockResolvedValue({ added: 12, removed: 4 })
    getDailyTotalsInRangeMock.mockResolvedValue({
      cost_micros: 50_000_000,
      conversions: 5,
      clicks: 100,
      impressions: 1000,
    })

    const result = await buildDailyRevenueFunnel({ referenceDate })
    expect(result).toEqual({
      newOrders: 2,
      orderRevenueCents: 7000,
      newSubs: 1,
      cancelledSubs: 0,
      newsletterNetDelta: 8,
      adSpendCents: 5000,
      adConversions: 5,
      adCplCents: 1000,
    })
  })

  it("handles ads with 0 conversions (cpl null)", async () => {
    getDailyTotalsInRangeMock.mockResolvedValue({
      cost_micros: 50_000_000, conversions: 0, clicks: 100, impressions: 1000,
    })
    const result = await buildDailyRevenueFunnel({ referenceDate })
    expect(result!.adCplCents).toBeNull()
  })
})
