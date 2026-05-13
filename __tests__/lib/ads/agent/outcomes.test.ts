import { describe, it, expect } from "vitest"
import { measureActionOutcome } from "@/lib/ads/agent/outcomes"
import type { GoogleAdsAgentMemoAction } from "@/types/database"

const action = (overrides: Partial<GoogleAdsAgentMemoAction> = {}): GoogleAdsAgentMemoAction => ({
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1" },
  rationale: "test",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  audit_confidence: "medium",
  significance: "sig",
  supporting_signals: [],
  status: "applied",
  recommendation_id: "rec-1",
  applied_at: "2026-04-15T00:00:00Z",
  clamped: false,
  ...overrides,
})

describe("measureActionOutcome", () => {
  it("computes CVR_delta_pct for keyword actions", async () => {
    const out = await measureActionOutcome(action(), {
      fetchCampaignWindow: async () => ({
        before: { clicks: 1000, conversions: 50 },
        after: { clicks: 1000, conversions: 80 },
      }),
    })
    expect(out.metrics.CVR_delta_pct).toBeCloseTo(60.0, 1) // 5% → 8% = +60%
    expect(out.significance).toBe("sig")
    expect(out.attribution).toBe("clean")
  })

  it("returns window_expired when applied_at is more than OUTCOME_WINDOW_EXPIRY_DAYS ago", async () => {
    const stale = action({ applied_at: "2025-01-01T00:00:00Z" })
    const out = await measureActionOutcome(stale, {
      fetchCampaignWindow: async () => ({ before: { clicks: 1, conversions: 0 }, after: { clicks: 1, conversions: 0 } }),
    })
    expect(out.error).toBe("window_expired")
  })

  it("returns not_yet_due when applied_at is less than 14 days ago", async () => {
    const recent = action({ applied_at: new Date(Date.now() - 5 * 86_400_000).toISOString() })
    const out = await measureActionOutcome(recent, {
      fetchCampaignWindow: async () => ({ before: { clicks: 1, conversions: 0 }, after: { clicks: 1, conversions: 0 } }),
    })
    expect(out.error).toBe("not_yet_due")
  })

  it("skips actions with status != 'applied'", async () => {
    const queued = action({ status: "queued", applied_at: null })
    const out = await measureActionOutcome(queued, {
      fetchCampaignWindow: async () => ({ before: { clicks: 0, conversions: 0 }, after: { clicks: 0, conversions: 0 } }),
    })
    expect(out.error).toBe("not_applied")
  })

  it("includes CAC_delta_pct when cost_usd present", async () => {
    const out = await measureActionOutcome(action(), {
      fetchCampaignWindow: async () => ({
        before: { clicks: 1000, conversions: 50, cost_usd: 1000 },
        after: { clicks: 1000, conversions: 80, cost_usd: 1200 },
      }),
    })
    // CAC before: 1000/50 = 20; after: 1200/80 = 15; delta: (15-20)/20 = -25%
    expect(out.metrics.CAC_delta_pct).toBeCloseTo(-25.0, 1)
  })

  it("returns no_data when no campaign_id is in args", async () => {
    const noCampaign = action({ args: {} })
    const out = await measureActionOutcome(noCampaign, {
      fetchCampaignWindow: async () => ({ before: { clicks: 0, conversions: 0 }, after: { clicks: 0, conversions: 0 } }),
    })
    expect(out.error).toBe("no_data")
  })
})

import { hasOverlappingAction } from "@/lib/ads/agent/outcomes"

describe("hasOverlappingAction", () => {
  it("returns true when another applied action touched the same campaign within 14 days", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    const sibling = action({ rank: 2, applied_at: "2026-05-07T00:00:00Z", args: { campaign_id: "c1" } })
    expect(hasOverlappingAction(a, [sibling])).toBe(true)
  })

  it("returns false when the sibling touched a different campaign", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    const sibling = action({ rank: 2, applied_at: "2026-05-07T00:00:00Z", args: { campaign_id: "c2" } })
    expect(hasOverlappingAction(a, [sibling])).toBe(false)
  })

  it("returns false when sibling is outside the 14-day window", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    const sibling = action({ rank: 2, applied_at: "2026-04-01T00:00:00Z", args: { campaign_id: "c1" } })
    expect(hasOverlappingAction(a, [sibling])).toBe(false)
  })

  it("returns false when the action itself is the only one (excludes self)", () => {
    const a = action({ rank: 1, applied_at: "2026-05-01T00:00:00Z", args: { campaign_id: "c1" } })
    expect(hasOverlappingAction(a, [a])).toBe(false)
  })
})
