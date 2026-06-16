import { describe, it, expect, vi, beforeEach } from "vitest"

// Track every Supabase insert.
// Hoisted so the mock factory below can close over the same reference the
// tests assert against.
const { inserted } = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            inserted.push({ table, row })
            return Promise.resolve({ data: { id: `${table}-${inserted.length}` }, error: null })
          },
        }),
      }),
    }),
  }),
}))

// Mock Claude with a valid decision.
// Use vi.hoisted so the constant exists when vi.mock factories run.
const { validDecision } = vi.hoisted(() => ({
  validDecision: {
    rationale: "Snapshot read.",
    actions: [
      {
        rank: 1, tool: "propose_new_keywords",
        args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "kw", match_type: "exact" }] },
        rationale: "Adding organic-winning query absent from campaign.",
        expected_metric: "CVR", expected_direction: "increase",
        confidence: "medium", supporting_signals: ["organic_wins_not_in_ads"],
      },
      {
        rank: 2, tool: "propose_negative_keywords",
        args: { campaign_id: "c1", negatives: [{ text: "DJP Athlete reviews", match_type: "phrase", scope: "campaign" }] },
        rationale: "Filter low-intent reviewer traffic.",
        expected_metric: "spend_efficiency", expected_direction: "increase",
        confidence: "low", supporting_signals: [],
      },
    ],
    watch_list: ["Watch CAC on Brand Search."],
    brief_alignment_score: null,
    agent_confidence: 6,
    dissent_from_upstream: { dissents: false, reason: null },
  },
}))

vi.mock("@/lib/ai/anthropic", () => ({
  MODEL_SONNET: "claude-sonnet-4-6",
  callAgent: vi.fn().mockResolvedValue({
    content: validDecision,
    tokens_used: 280,
  }),
}))

import { gatherAdsSignals } from "@/lib/ads/agent/signals"
import { reasonAdsDecision } from "@/lib/ads/agent/reason"
import { applyGuardrailsBatch } from "@/lib/ads/agent/guardrails"
import { executeAdsActions, type PreExecutionPair } from "@/lib/ads/agent/execute"

function makeEmptyFetchers() {
  return {
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
    fetchCampaignToLandingPageMap: async () => ({}),
  }
}

describe("ads agent end-to-end", () => {
  beforeEach(() => {
    inserted.length = 0
  })

  it("preflight-failed path returns preflight.ok=false and skips reasoning", async () => {
    const signals = await gatherAdsSignals({
      ...makeEmptyFetchers(),
      fetchPreflightInput: async () => ({
        mostRecentConversionAt: new Date(),
        ga4SyncedAt: new Date(),
        gscSyncedAt: new Date(),
        tokensValid: { googleAds: true, ga4: true, gsc: true },
        activeCampaignClicks7d: 0, // <-- triggers preflight fail
      }),
    })
    expect(signals.preflight.ok).toBe(false)
    expect(signals.raw).toBeNull()
    expect(signals.derived).toBeNull()
    expect(signals.learning).toBeNull()
  })

  it("happy path: preflight passes → reason → guardrails → execute writes only allowed actions", async () => {
    // Healthy signals: one 60-day-old campaign with 500 clicks + 25 conversions.
    const healthyCampaign = {
      id: "c1",
      name: "Brand Search",
      status: "ENABLED",
      daily_budget_usd: 25,
      created_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      last_7d_conversions: 0,
      metrics_28d: {
        clicks: 500, impressions: 10_000, ctr: 0.05,
        conversions: 25, cvr: 0.05, cost_usd: 400,
        cac_usd: 16, roas: 3,
        impression_share: 0.5,
        impression_share_lost_budget: 0.1,
        impression_share_lost_rank: 0.1,
      },
    }
    const signals = await gatherAdsSignals({
      ...makeEmptyFetchers(),
      fetchPreflightInput: async () => ({
        mostRecentConversionAt: new Date(),
        ga4SyncedAt: new Date(),
        gscSyncedAt: new Date(),
        tokensValid: { googleAds: true, ga4: true, gsc: true },
        activeCampaignClicks7d: 200,
      }),
      fetchCampaigns: async () => [healthyCampaign],
    })
    expect(signals.preflight.ok).toBe(true)

    const { decision, tokensUsed } = await reasonAdsDecision(signals)
    expect(decision.actions).toHaveLength(2)
    expect(tokensUsed).toBe(280)

    const results = applyGuardrailsBatch(decision.actions, signals)
    // Action 1 (propose_new_keywords on healthy campaign) should pass guardrails.
    // Action 2 (propose_negative_keywords with brand term "DJP Athlete reviews") should be rejected.
    expect(results[0].kind).toBe("pass")
    expect(results[1].kind).toBe("reject")
    if (results[1].kind === "reject") {
      expect(results[1].reason).toMatch(/brand/i)
    }

    const pairs: PreExecutionPair[] = decision.actions.map((originalAction, i) => ({
      originalAction,
      guardrail: results[i],
    }))
    const out = await executeAdsActions(pairs, { memo_id: "memo-test", customer_id: "cust-test" })

    // Only the passing action reaches the recommendations table.
    expect(inserted).toHaveLength(1)
    expect(inserted[0].table).toBe("google_ads_recommendations")

    // Memo actions record both: one queued, one rejected_by_guardrails.
    expect(out.actions).toHaveLength(2)
    expect(out.actions.map((a) => a.status).sort()).toEqual(["queued", "rejected_by_guardrails"])
    expect(out.rejections).toHaveLength(1)
    expect(out.rejections[0].tool).toBe("propose_negative_keywords")
    expect(out.rejections[0].reason).toMatch(/brand/i)
  })
})
