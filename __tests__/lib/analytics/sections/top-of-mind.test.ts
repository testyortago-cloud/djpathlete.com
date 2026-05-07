import { describe, it, expect } from "vitest"
import { buildTopOfMind } from "@/lib/analytics/sections/top-of-mind"
import type {
  WeeklyCoachingPayload,
  WeeklyRevenuePayload,
  WeeklyFunnelPayload,
} from "@/types/coach-emails"

const baseCoaching: WeeklyCoachingPayload = {
  activeClients: { current: 12, previous: 9 },
  sessionsCompleted: { current: 48, previous: 40 },
  programCompletionRatePct: { current: 78, previous: 72 },
  formReviewsDelivered: { current: 6, previous: 4 },
  avgFormReviewResponseHours: { current: 38, previous: 22 },
  silentClients: 0,
}

describe("buildTopOfMind", () => {
  it("returns the neutral line when no metric clears its floor", () => {
    const result = buildTopOfMind({ coaching: null, revenue: null, funnel: null })
    expect(result).toEqual([{ text: "Quiet week across the board.", positive: null }])
  })

  it("ranks bullets by absolute % delta", () => {
    const result = buildTopOfMind({ coaching: baseCoaching, revenue: null, funnel: null })
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(5)
    // form-review response time +73% (38 vs 22) is the biggest move; should appear first as negative
    expect(result[0].text).toMatch(/Form review response/i)
    expect(result[0].positive).toBe(false)
  })

  it("respects per-metric floors (no '+9000% from 1' noise)", () => {
    const tiny: WeeklyCoachingPayload = {
      ...baseCoaching,
      sessionsCompleted: { current: 4, previous: 1 }, // below floor of 5 — skip
    }
    const result = buildTopOfMind({ coaching: tiny, revenue: null, funnel: null })
    expect(result.find((b) => /sessions/i.test(b.text))).toBeUndefined()
  })
})
