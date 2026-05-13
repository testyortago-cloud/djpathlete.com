import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  runPreflight,
  gatherRawInputs,
  deriveCrossChannelSignals,
  deriveLearningLayer,
} from "@/lib/ads/agent/signals"

describe("ads agent preflight", () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-13T12:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("fails when most recent conversion is older than CONVERSION_FRESHNESS_HOURS", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-10T12:00:00Z"), // 72h ago
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /conversion tracking.*stale/i.test(r))).toBe(true)
  })

  it("fails when no active campaign has ≥ MIN_RECENT_CLICKS clicks in last 7 days", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 5,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /insufficient.*clicks/i.test(r))).toBe(true)
  })

  it("fails when any OAuth token is invalid", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: false, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => /ga4.*token/i.test(r))).toBe(true)
  })

  it("passes when all checks succeed", async () => {
    const result = await runPreflight({
      mostRecentConversionAt: new Date("2026-05-13T06:00:00Z"),
      ga4SyncedAt: new Date("2026-05-13T06:00:00Z"),
      gscSyncedAt: new Date("2026-05-13T06:00:00Z"),
      tokensValid: { googleAds: true, ga4: true, gsc: true },
      activeCampaignClicks7d: 200,
    })
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

describe("gatherRawInputs", () => {
  it("returns a JSON-serializable AdsRawInputs shape with all key sources", async () => {
    const result = await gatherRawInputs({
      fetchCampaigns: async () => [],
      fetchSearchTermsTopSpend: async () => [],
      fetchSearchTermsTopConversions: async () => [],
      fetchPendingRecommendations: async () => [],
      fetchConversionActions: async () => [],
      fetchGa4: async () => ({ sessions_by_source_medium: [], landing_page_engagement: [] }),
      fetchGscOrganicTop10: async () => [],
      fetchPipeline: async () => ({
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      }),
      fetchPriorMemos: async () => [],
    })
    expect(result).toHaveProperty("campaigns")
    expect(result).toHaveProperty("search_terms_top_spend")
    expect(result).toHaveProperty("search_terms_top_conversions")
    expect(result).toHaveProperty("pending_recommendations")
    expect(result).toHaveProperty("conversion_actions")
    expect(result).toHaveProperty("ga4")
    expect(result).toHaveProperty("gsc_organic_top10")
    expect(result).toHaveProperty("pipeline")
    expect(result).toHaveProperty("prior_memos")
    expect(JSON.stringify(result)).toBeTruthy()
  })

  it("invokes all fetchers in parallel (Promise.all)", async () => {
    let parallelCount = 0
    let maxParallel = 0
    const slow = async <T,>(value: T): Promise<T> => {
      parallelCount += 1
      maxParallel = Math.max(maxParallel, parallelCount)
      await new Promise((r) => setTimeout(r, 5))
      parallelCount -= 1
      return value
    }
    await gatherRawInputs({
      fetchCampaigns: () => slow([]),
      fetchSearchTermsTopSpend: () => slow([]),
      fetchSearchTermsTopConversions: () => slow([]),
      fetchPendingRecommendations: () => slow([]),
      fetchConversionActions: () => slow([]),
      fetchGa4: () => slow({ sessions_by_source_medium: [], landing_page_engagement: [] }),
      fetchGscOrganicTop10: () => slow([]),
      fetchPipeline: () => slow({
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      }),
      fetchPriorMemos: () => slow([]),
    })
    // 9 fetchers; should all run concurrently
    expect(maxParallel).toBeGreaterThanOrEqual(9)
  })
})

describe("deriveCrossChannelSignals", () => {
  it("surfaces paid_terms_already_organic when paid spend >= threshold AND organic position <= 5", () => {
    const raw = {
      campaigns: [], pending_recommendations: [], conversion_actions: [],
      search_terms_top_conversions: [],
      ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
      pipeline: {
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      },
      prior_memos: [],
      search_terms_top_spend: [
        { text: "comeback code", campaign_id: "c1", cost_usd: 50, clicks: 30, conversions: 2 },
      ],
      gsc_organic_top10: [
        { query: "comeback code", page: "/comeback", position: 3, clicks: 80, impressions: 1000 },
      ],
    } as unknown as Parameters<typeof deriveCrossChannelSignals>[0]
    const derived = deriveCrossChannelSignals(raw)
    expect(derived.paid_terms_already_organic).toHaveLength(1)
    expect(derived.paid_terms_already_organic[0].query).toBe("comeback code")
  })

  it("surfaces organic_wins_not_in_ads (GSC clicks >= 10, position <= 10, not in paid)", () => {
    const raw = {
      campaigns: [], pending_recommendations: [], conversion_actions: [],
      search_terms_top_conversions: [],
      ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
      pipeline: {
        visits: 0, signups: 0, bookings: 0, payments: 0,
        visits_to_signup: 0, signup_to_booking: 0, booking_to_payment: 0,
      },
      prior_memos: [],
      search_terms_top_spend: [],
      gsc_organic_top10: [
        { query: "rotational reboot", page: "/reboot", position: 4, clicks: 40, impressions: 800 },
      ],
    } as unknown as Parameters<typeof deriveCrossChannelSignals>[0]
    const derived = deriveCrossChannelSignals(raw)
    expect(derived.organic_wins_not_in_ads).toHaveLength(1)
    expect(derived.organic_wins_not_in_ads[0].query).toBe("rotational reboot")
  })

  it("surfaces landing_page_engagement_mismatch when CTR is high-tier but engagement < floor", () => {
    const raw = {
      campaigns: [
        { id: "c1", name: "x", status: "ENABLED", daily_budget_usd: 10, created_at: "2025-01-01",
          last_7d_conversions: 0,
          metrics_28d: { clicks: 1000, impressions: 10_000, ctr: 0.1, conversions: 5, cvr: 0.005, cost_usd: 100, cac_usd: 20, roas: 1, impression_share: 0.5, impression_share_lost_budget: 0, impression_share_lost_rank: 0 } },
        { id: "c2", name: "y", status: "ENABLED", daily_budget_usd: 10, created_at: "2025-01-01",
          last_7d_conversions: 0,
          metrics_28d: { clicks: 500, impressions: 10_000, ctr: 0.05, conversions: 5, cvr: 0.01, cost_usd: 100, cac_usd: 20, roas: 1, impression_share: 0.5, impression_share_lost_budget: 0, impression_share_lost_rank: 0 } },
      ],
      pending_recommendations: [], conversion_actions: [], search_terms_top_conversions: [], search_terms_top_spend: [],
      gsc_organic_top10: [], pipeline: { visits:0, signups:0, bookings:0, payments:0, visits_to_signup:0, signup_to_booking:0, booking_to_payment:0 }, prior_memos: [],
      ga4: {
        sessions_by_source_medium: [],
        landing_page_engagement: [
          { page_path: "/c1-lp", engagement_rate: 0.2, sessions: 500 },
        ],
      },
    } as unknown as Parameters<typeof deriveCrossChannelSignals>[0]
    const derived = deriveCrossChannelSignals(raw, { c1: "/c1-lp", c2: "/c2-lp" })
    expect(derived.landing_page_engagement_mismatch).toHaveLength(1)
    expect(derived.landing_page_engagement_mismatch[0].campaign_id).toBe("c1")
  })
})

describe("deriveLearningLayer", () => {
  it("classifies prior actions whose outcome moved the predicted direction as worked", () => {
    const raw = {
      campaigns: [], pending_recommendations: [], conversion_actions: [], search_terms_top_conversions: [], search_terms_top_spend: [],
      ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
      gsc_organic_top10: [],
      pipeline: { visits:0, signups:0, bookings:0, payments:0, visits_to_signup:0, signup_to_booking:0, booking_to_payment:0 },
      prior_memos: [
        {
          id: "m1", week_of: "2026-04-29", outcome_status: "measured",
          outcome_metrics: { c1: { CVR_delta_pct: 18.0 } },
          actions: [
            {
              rank: 1, tool: "propose_new_keywords",
              args: { campaign_id: "c1" }, rationale: "",
              expected_metric: "CVR", expected_direction: "increase",
              confidence: "medium", audit_confidence: "medium", significance: "sig",
              supporting_signals: [], status: "applied", recommendation_id: "r1",
              applied_at: "2026-04-30", clamped: false,
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof deriveLearningLayer>[0]
    const learning = deriveLearningLayer(raw, new Date("2026-05-13"))
    expect(learning.prior_actions_that_worked).toHaveLength(1)
    expect(learning.prior_actions_that_failed).toHaveLength(0)
  })
})
