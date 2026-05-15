import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ai/anthropic", () => ({
  MODEL_SONNET: "claude-sonnet-4-20250514",
  callAgent: vi.fn(),
}))

import { reasonAdsDecision } from "@/lib/ads/agent/reason"
import { callAgent } from "@/lib/ai/anthropic"
import type { AdsSignals } from "@/lib/ads/agent/types"

const validDecision = {
  rationale: "Snapshot read.",
  actions: [
    {
      rank: 1,
      tool: "propose_new_keywords",
      args: {
        campaign_id: "c1",
        ad_group_id: "ag1",
        keywords: [{ text: "x", match_type: "exact" }],
      },
      rationale: "Adding organic-winning query absent from campaign.",
      expected_metric: "CVR",
      expected_direction: "increase",
      confidence: "medium",
      supporting_signals: ["organic_wins_not_in_ads"],
    },
  ],
  watch_list: [],
  brief_alignment_score: null,
  agent_confidence: 6,
  dissent_from_upstream: { dissents: false, reason: null },
}

const passingSignals: AdsSignals = {
  generated_at: new Date().toISOString(),
  preflight: { ok: true, reasons: [] },
  raw: {
    campaigns: [],
    search_terms_top_spend: [],
    search_terms_top_conversions: [],
    pending_recommendations: [],
    conversion_actions: [],
    ga4: { sessions_by_source_medium: [], landing_page_engagement: [] },
    gsc_organic_top10: [],
    pipeline: {
      visits: 0,
      signups: 0,
      bookings: 0,
      payments: 0,
      visits_to_signup: 0,
      signup_to_booking: 0,
      booking_to_payment: 0,
    },
    prior_memos: [],
  },
  derived: {
    paid_terms_already_organic: [],
    organic_wins_not_in_ads: [],
    landing_page_engagement_mismatch: [],
  },
  learning: {
    winning_keywords: [],
    winning_audiences: [],
    winning_ad_creative: [],
    winning_schedule: [],
    winning_geos: [],
    prior_actions_that_worked: [],
    prior_actions_that_failed: [],
  },
  gaps: [],
  brief_context: null,
}

describe("reasonAdsDecision", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the decision on first valid response", async () => {
    ;(callAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: validDecision,
      tokens_used: 150,
    })
    const out = await reasonAdsDecision(passingSignals)
    expect(out.decision).toEqual(validDecision)
    expect(out.tokensUsed).toBe(150)
  })

  it("retries once on Zod failure and succeeds on second attempt", async () => {
    ;(callAgent as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        content: { rationale: "x", actions: [{ tool: "garbage" }], watch_list: [] },
        tokens_used: 0,
      })
      .mockResolvedValueOnce({
        content: validDecision,
        tokens_used: 150,
      })
    const out = await reasonAdsDecision(passingSignals)
    expect(out.decision).toEqual(validDecision)
    expect((callAgent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it("throws when both attempts fail Zod validation", async () => {
    ;(callAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: { not: "valid" },
      tokens_used: 0,
    })
    await expect(reasonAdsDecision(passingSignals)).rejects.toThrow(
      /decision.*invalid/i,
    )
  })
})
