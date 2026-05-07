import { describe, it, expect, vi, beforeEach } from "vitest"

const getDailyTotalsInRangeMock = vi.fn()
const getGenerationLogsMock = vi.fn()

vi.mock("@/lib/db/google-ads-metrics", () => ({
  getDailyTotalsInRange: (...a: unknown[]) => getDailyTotalsInRangeMock(...a),
}))
vi.mock("@/lib/db/ai-generation-log", () => ({
  getGenerationLogs: (...a: unknown[]) => getGenerationLogsMock(...a),
}))

import { buildDailyAnomalies } from "@/lib/analytics/sections/anomalies-daily"
import type { DailyRevenueFunnelPayload } from "@/types/coach-emails"

const referenceDate = new Date("2026-05-07T07:00:00-05:00")
const baselineFunnel: DailyRevenueFunnelPayload = {
  newOrders: 0, orderRevenueCents: 0, newSubs: 0, cancelledSubs: 0,
  newsletterNetDelta: 0, adSpendCents: 1000, adConversions: 1, adCplCents: 1000,
}

describe("buildDailyAnomalies", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDailyTotalsInRangeMock.mockResolvedValue({
      cost_micros: 70_000_000, conversions: 7, clicks: 0, impressions: 0,
    })
    getGenerationLogsMock.mockResolvedValue([])
  })

  it("returns null when nothing is anomalous", async () => {
    expect(await buildDailyAnomalies({ referenceDate, dailyFunnel: baselineFunnel })).toBeNull()
  })

  it("flags an ad CPL spike (>=50% above 7-day avg AND >= $20)", async () => {
    getDailyTotalsInRangeMock.mockResolvedValue({
      cost_micros: 70_000_000, conversions: 7,
      clicks: 0, impressions: 0,
    })
    const todayFunnel: DailyRevenueFunnelPayload = {
      ...baselineFunnel, adSpendCents: 5000, adConversions: 1, adCplCents: 5000,
    }
    const result = await buildDailyAnomalies({ referenceDate, dailyFunnel: todayFunnel })
    expect(result).not.toBeNull()
    expect(result!.flags.some((f) => f.label === "Ad CPL spike")).toBe(true)
  })

  it("flags AI generation failures (>=3 in last 24h)", async () => {
    getGenerationLogsMock.mockResolvedValue([
      { id: "g1", status: "failed", created_at: new Date(referenceDate.getTime() - 3600_000).toISOString() },
      { id: "g2", status: "failed", created_at: new Date(referenceDate.getTime() - 7200_000).toISOString() },
      { id: "g3", status: "failed", created_at: new Date(referenceDate.getTime() - 10800_000).toISOString() },
    ])
    const result = await buildDailyAnomalies({ referenceDate, dailyFunnel: baselineFunnel })
    expect(result!.flags.some((f) => f.label === "AI generation failures")).toBe(true)
  })
})
