import { describe, it, expect } from "vitest"
import { applyGuardrails } from "@/lib/ads/agent/guardrails"
import type { AdsAction, AdsSignals } from "@/lib/ads/agent/types"

const makeAction = (overrides: Partial<AdsAction> = {}): AdsAction => ({
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
  rationale: "test",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: [],
  ...overrides,
})

const makeSignals = (overrides: Partial<NonNullable<AdsSignals["raw"]>> = {}): AdsSignals => ({
  generated_at: new Date().toISOString(),
  preflight: { ok: true, reasons: [] },
  raw: {
    campaigns: [
      {
        id: "c1",
        name: "Brand Search",
        status: "ENABLED",
        daily_budget_usd: 25,
        created_at: new Date(Date.now() - 60 * 86_400_000).toISOString(), // 60 days old
        last_7d_conversions: 0,
        metrics_28d: {
          clicks: 500,
          impressions: 10_000,
          ctr: 0.05,
          conversions: 25,
          cvr: 0.05,
          cost_usd: 400,
          cac_usd: 16,
          roas: 3,
          impression_share: 0.5,
          impression_share_lost_budget: 0.1,
          impression_share_lost_rank: 0.1,
        },
      },
    ],
    search_terms_top_spend: [],
    search_terms_top_conversions: [],
    pending_recommendations: [],
    conversion_actions: [],
    ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
    gsc_organic_top10: [],
    pipeline: {
      visits: 100, signups: 10, bookings: 5, payments: 2,
      visits_to_signup: 0.1, signup_to_booking: 0.5, booking_to_payment: 0.4,
    },
    prior_memos: [],
    ...overrides,
  },
  derived: { paid_terms_already_organic: [], organic_wins_not_in_ads: [], landing_page_engagement_mismatch: [] },
  learning: {
    winning_keywords: [], winning_audiences: [], winning_ad_creative: [],
    winning_schedule: [], winning_geos: [],
    prior_actions_that_worked: [], prior_actions_that_failed: [],
  },
  gaps: [],
})

describe("guardrails — campaign age", () => {
  it("rejects action targeting a campaign younger than 14 days", () => {
    const youngSignals = makeSignals()
    youngSignals.raw!.campaigns[0].created_at = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const result = applyGuardrails(makeAction(), youngSignals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/learning period/i)
  })

  it("allows action targeting a 60-day-old campaign", () => {
    const result = applyGuardrails(makeAction(), makeSignals())
    expect(result.kind).toBe("pass")
  })
})

describe("guardrails — data volume", () => {
  it("rejects when campaign has < 30 clicks in 28d", () => {
    const signals = makeSignals()
    signals.raw!.campaigns[0].metrics_28d.clicks = 10
    const result = applyGuardrails(makeAction(), signals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/insufficient.+click/i)
  })

  it("rejects when campaign has < 3 conversions in 28d", () => {
    const signals = makeSignals()
    signals.raw!.campaigns[0].metrics_28d.conversions = 1
    const result = applyGuardrails(makeAction(), signals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/insufficient.+conversion/i)
  })
})
