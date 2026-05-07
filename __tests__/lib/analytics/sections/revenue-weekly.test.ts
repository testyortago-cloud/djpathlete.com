import { describe, it, expect, vi, beforeEach } from "vitest"

const listSubscriptionsChangedInRangeMock = vi.fn()
const countRenewalsInRangeMock = vi.fn()
const getMrrCentsMock = vi.fn()
const listOrdersInRangeMock = vi.fn()
const sumRefundsInRangeMock = vi.fn()

vi.mock("@/lib/db/subscriptions", () => ({
  listSubscriptionsChangedInRange: (...a: unknown[]) => listSubscriptionsChangedInRangeMock(...a),
  countRenewalsInRange: (...a: unknown[]) => countRenewalsInRangeMock(...a),
  getMrrCents: (...a: unknown[]) => getMrrCentsMock(...a),
}))
vi.mock("@/lib/db/shop-orders", () => ({
  listOrdersInRange: (...a: unknown[]) => listOrdersInRangeMock(...a),
  sumRefundsInRange: (...a: unknown[]) => sumRefundsInRangeMock(...a),
}))

import { buildWeeklyRevenue } from "@/lib/analytics/sections/revenue-weekly"

const range = { from: new Date("2026-04-30T00:00:00Z"), to: new Date("2026-05-07T00:00:00Z") }
const previousRange = { from: new Date("2026-04-23T00:00:00Z"), to: new Date("2026-04-30T00:00:00Z") }

describe("buildWeeklyRevenue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSubscriptionsChangedInRangeMock.mockResolvedValue({ created: 0, cancelled: 0 })
    countRenewalsInRangeMock.mockResolvedValue(0)
    getMrrCentsMock.mockResolvedValue(0)
    listOrdersInRangeMock.mockResolvedValue([])
    sumRefundsInRangeMock.mockResolvedValue(0)
  })

  it("returns null when nothing happened both weeks", async () => {
    expect(await buildWeeklyRevenue({ range, previousRange })).toBeNull()
  })

  it("computes deltas across subs / shop / refunds", async () => {
    listSubscriptionsChangedInRangeMock
      .mockResolvedValueOnce({ created: 3, cancelled: 1 })
      .mockResolvedValueOnce({ created: 2, cancelled: 0 })
    countRenewalsInRangeMock.mockResolvedValueOnce(5).mockResolvedValueOnce(4)
    getMrrCentsMock.mockResolvedValue(120_000) // single snapshot
    listOrdersInRangeMock
      .mockResolvedValueOnce([{ total_cents: 5000 }, { total_cents: 7500 }])
      .mockResolvedValueOnce([{ total_cents: 3000 }])
    sumRefundsInRangeMock.mockResolvedValueOnce(2000).mockResolvedValueOnce(0)

    const result = await buildWeeklyRevenue({ range, previousRange })
    expect(result).toEqual({
      mrrCents: { current: 120_000, previous: 0 },
      newSubs: { current: 3, previous: 2 },
      cancelledSubs: { current: 1, previous: 0 },
      renewedSubs: { current: 5, previous: 4 },
      shopRevenueCents: { current: 12500, previous: 3000 },
      refundsCents: { current: 2000, previous: 0 },
    })
  })
})
