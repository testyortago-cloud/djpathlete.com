import { describe, it, expect, vi, beforeEach } from "vitest"

const getSubscriberDeltaInRangeMock = vi.fn()
const countLeadsInRangeMock = vi.fn()
const getDailyTotalsInRangeMock = vi.fn()
const countByAttributionSourceInRangeMock = vi.fn()

vi.mock("@/lib/db/newsletter", () => ({
  getSubscriberDeltaInRange: (...a: unknown[]) => getSubscriberDeltaInRangeMock(...a),
}))
vi.mock("@/lib/db/shop-leads", () => ({
  countLeadsInRange: (...a: unknown[]) => countLeadsInRangeMock(...a),
}))
vi.mock("@/lib/db/google-ads-metrics", () => ({
  getDailyTotalsInRange: (...a: unknown[]) => getDailyTotalsInRangeMock(...a),
}))
vi.mock("@/lib/db/marketing-attribution", () => ({
  countByAttributionSourceInRange: (...a: unknown[]) => countByAttributionSourceInRangeMock(...a),
}))

import { buildWeeklyFunnel } from "@/lib/analytics/sections/funnel-weekly"

const range = { from: new Date("2026-04-30T00:00:00Z"), to: new Date("2026-05-07T00:00:00Z") }
const previousRange = { from: new Date("2026-04-23T00:00:00Z"), to: new Date("2026-04-30T00:00:00Z") }

describe("buildWeeklyFunnel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSubscriberDeltaInRangeMock.mockResolvedValue({ added: 0, removed: 0 })
    countLeadsInRangeMock.mockResolvedValue(0)
    getDailyTotalsInRangeMock.mockResolvedValue({
      cost_micros: 0, conversions: 0, clicks: 0, impressions: 0,
    })
    countByAttributionSourceInRangeMock.mockResolvedValue([])
  })

  it("returns null when no inflow either week", async () => {
    expect(await buildWeeklyFunnel({ range, previousRange })).toBeNull()
  })

  it("aggregates deltas + attribution", async () => {
    getSubscriberDeltaInRangeMock
      .mockResolvedValueOnce({ added: 30, removed: 5 })
      .mockResolvedValueOnce({ added: 22, removed: 2 })
    countLeadsInRangeMock.mockResolvedValueOnce(8).mockResolvedValueOnce(6)
    getDailyTotalsInRangeMock
      .mockResolvedValueOnce({ cost_micros: 350_000_000, conversions: 14, clicks: 0, impressions: 0 })
      .mockResolvedValueOnce({ cost_micros: 280_000_000, conversions: 10, clicks: 0, impressions: 0 })
    countByAttributionSourceInRangeMock.mockResolvedValue([
      { source: "google", count: 12 },
      { source: "instagram", count: 7 },
    ])

    const result = await buildWeeklyFunnel({ range, previousRange })
    expect(result).not.toBeNull()
    expect(result!.newsletterNetDelta).toEqual({ current: 25, previous: 20 })
    expect(result!.shopLeads).toEqual({ current: 8, previous: 6 })
    expect(result!.adSpendCents).toEqual({ current: 35_000, previous: 28_000 })
    expect(result!.adConversions).toEqual({ current: 14, previous: 10 })
    expect(result!.adCplCents).toEqual({ current: 2500, previous: 2800 })
    expect(result!.attributionBySource[0].source).toBe("google")
  })
})
