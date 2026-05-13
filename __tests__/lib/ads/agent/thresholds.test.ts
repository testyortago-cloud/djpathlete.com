import { describe, it, expect } from "vitest"
import * as T from "@/lib/ads/agent/thresholds"

describe("ads agent thresholds", () => {
  it("data-quality preflight thresholds are defined and sensible", () => {
    expect(T.CONVERSION_FRESHNESS_HOURS).toBe(48)
    expect(T.MIN_RECENT_CLICKS).toBe(30)
    expect(T.RECENT_CLICKS_WINDOW_DAYS).toBe(7)
  })

  it("derived-signal thresholds match spec defaults", () => {
    expect(T.PAID_SPEND_THRESHOLD_USD).toBe(20)
    expect(T.ORGANIC_OVERLAP_MAX_POSITION).toBe(5)
    expect(T.ORGANIC_WIN_MIN_CLICKS).toBe(10)
    expect(T.ORGANIC_WIN_MAX_POSITION).toBe(10)
    expect(T.LP_ENGAGEMENT_FLOOR).toBeCloseTo(0.4)
  })

  it("guardrail thresholds match spec defaults", () => {
    expect(T.CAMPAIGN_MIN_AGE_DAYS).toBe(14)
    expect(T.MIN_CLICKS_FOR_RECOMMENDATION).toBe(30)
    expect(T.MIN_CONVERSIONS_FOR_RECOMMENDATION).toBe(3)
    expect(T.MAX_BUDGET_SHIFT_PCT).toBe(20)
    expect(T.NEW_CAMPAIGN_MAX_DAILY_BUDGET).toBe(30)
    expect(T.MAX_NEW_DAILY_SPEND_PER_MEMO).toBe(100)
    expect(T.LARGE_BUDGET_SHIFT_USD).toBe(50)
    expect(T.MIN_AUDIENCE_SIZE).toBe(1_000)
  })

  it("brand allowlist contains DJP Athlete variants", () => {
    expect(T.BRAND_TERM_ALLOWLIST.length).toBeGreaterThan(0)
    expect(T.BRAND_TERM_ALLOWLIST).toContain("djp athlete")
  })

  it("outcome window is 14 days", () => {
    expect(T.OUTCOME_WINDOW_DAYS).toBe(14)
  })
})
