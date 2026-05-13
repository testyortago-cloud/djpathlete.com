import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { runPreflight, gatherRawInputs } from "@/lib/ads/agent/signals"

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
