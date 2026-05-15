import { describe, it, expect } from "vitest"
import {
  applyGuardrails,
  applyGuardrailsBatch,
  computeSignificance,
  computeAuditConfidence,
} from "@/lib/ads/agent/guardrails"
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
  brief_context: null,
  tool_performance: [],
  few_shots: [],
})

describe("guardrails — brief dont_do", () => {
  const briefContext = {
    brief_id: "b1",
    week_of: "2026-05-11",
    themes: [],
    audience_focus: "comeback athletes",
    priority_channel: "ads" as const,
    keywords_to_chase: [],
    hooks_to_test: [],
    ctas: [],
    dont_do: ["free trial", "discount"],
  }

  it("rejects an action whose payload mentions a dont_do phrase (case-insensitive)", () => {
    const signals = makeSignals()
    signals.brief_context = briefContext
    const action = makeAction({
      tool: "propose_new_keywords",
      args: {
        campaign_id: "c1",
        ad_group_id: "ag1",
        keywords: [{ text: "Free Trial Coaching", match_type: "phrase" }],
      },
    })
    const result = applyGuardrails(action, signals)
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") {
      expect(result.reason).toMatch(/brief_dont_do/)
      expect(result.reason).toMatch(/free trial/i)
    }
  })

  it("passes action when brief is null", () => {
    const result = applyGuardrails(makeAction(), makeSignals())
    expect(result.kind).toBe("pass")
  })

  it("passes action whose payload does not mention any dont_do phrase", () => {
    const signals = makeSignals()
    signals.brief_context = briefContext
    const result = applyGuardrails(makeAction(), signals)
    expect(result.kind).toBe("pass")
  })
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

describe("guardrails — budget clamp", () => {
  it("clamps a 50% budget shift to ±20%", () => {
    const action = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 50 },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("pass")
    if (result.kind === "pass") {
      expect(result.action.args.delta_pct).toBe(20)
      expect(result.annotations.clamped).toBe(true)
    }
  })

  it("clamps a -75% budget shift to -20%", () => {
    const action = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: -75 },
    })
    const result = applyGuardrails(action, makeSignals())
    if (result.kind === "pass") {
      expect(result.action.args.delta_pct).toBe(-20)
      expect(result.annotations.clamped).toBe(true)
    }
  })

  it("leaves a 10% budget shift unchanged", () => {
    const action = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 10 },
    })
    const result = applyGuardrails(action, makeSignals())
    if (result.kind === "pass") {
      expect(result.action.args.delta_pct).toBe(10)
      expect(result.annotations.clamped).toBe(false)
    }
  })
})

describe("guardrails — pause protection", () => {
  it("rejects propose_campaign_pause if campaign drove ≥1 conversion in last 7 days", () => {
    const signals = makeSignals()
    signals.raw!.campaigns[0].last_7d_conversions = 2
    const result = applyGuardrails(
      makeAction({ tool: "propose_campaign_pause", args: { campaign_id: "c1", reason: "x" } }),
      signals,
    )
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/conversion.+last 7 days/i)
  })

  it("allows propose_campaign_pause if campaign drove 0 conversions in last 7 days", () => {
    const signals = makeSignals()
    signals.raw!.campaigns[0].last_7d_conversions = 0
    const result = applyGuardrails(
      makeAction({ tool: "propose_campaign_pause", args: { campaign_id: "c1", reason: "x" } }),
      signals,
    )
    expect(result.kind).toBe("pass")
  })
})

describe("guardrails — brand allowlist", () => {
  it("rejects negative-keyword action containing a brand term (case-insensitive)", () => {
    const action = makeAction({
      tool: "propose_negative_keywords",
      args: {
        campaign_id: "c1",
        negatives: [{ text: "DJP Athlete reviews", match_type: "phrase", scope: "campaign" }],
      },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/brand/i)
  })

  it("allows negative-keyword action with no brand-term overlap", () => {
    const action = makeAction({
      tool: "propose_negative_keywords",
      args: {
        campaign_id: "c1",
        negatives: [{ text: "free download", match_type: "phrase", scope: "campaign" }],
      },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("pass")
  })
})

describe("guardrails — match-type direction", () => {
  it("allows broad → phrase tightening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "broad", to_match_type: "phrase" },
    })
    expect(applyGuardrails(action, makeSignals()).kind).toBe("pass")
  })

  it("allows phrase → exact tightening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "phrase", to_match_type: "exact" },
    })
    expect(applyGuardrails(action, makeSignals()).kind).toBe("pass")
  })

  it("rejects exact → phrase loosening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "exact", to_match_type: "phrase" },
    })
    const result = applyGuardrails(action, makeSignals())
    expect(result.kind).toBe("reject")
    if (result.kind === "reject") expect(result.reason).toMatch(/loosen/i)
  })

  it("rejects phrase → broad loosening", () => {
    const action = makeAction({
      tool: "propose_match_type_change",
      args: { ad_group_id: "ag1", keyword_id: "kw1", from_match_type: "phrase", to_match_type: "broad" },
    })
    expect(applyGuardrails(action, makeSignals()).kind).toBe("reject")
  })
})

describe("guardrails — new-campaign caps (memo-level batch)", () => {
  it("rejects more than 1 propose_new_campaign per memo", () => {
    const a1 = makeAction({
      tool: "propose_new_campaign",
      args: { name: "C1", type: "search", initial_daily_budget: 20, target_keywords: ["a"], landing_page_url: "/x", conversion_action_ids: ["ca1"] },
    })
    const a2 = makeAction({
      rank: 2,
      tool: "propose_new_campaign",
      args: { name: "C2", type: "search", initial_daily_budget: 20, target_keywords: ["b"], landing_page_url: "/y", conversion_action_ids: ["ca1"] },
    })
    const results = applyGuardrailsBatch([a1, a2], makeSignals())
    expect(results[0].kind).toBe("pass")
    expect(results[1].kind).toBe("reject")
    if (results[1].kind === "reject") expect(results[1].reason).toMatch(/already proposed.*new campaign/i)
  })

  it("rejects propose_new_campaign exceeding NEW_CAMPAIGN_MAX_DAILY_BUDGET", () => {
    const a = makeAction({
      tool: "propose_new_campaign",
      args: { name: "Big", type: "search", initial_daily_budget: 100, target_keywords: ["a"], landing_page_url: "/x", conversion_action_ids: ["ca1"] },
    })
    const results = applyGuardrailsBatch([a], makeSignals())
    expect(results[0].kind).toBe("reject")
    if (results[0].kind === "reject") expect(results[0].reason).toMatch(/exceeds.*daily budget/i)
  })

  it("rejects when total NEW daily spend across actions > MAX_NEW_DAILY_SPEND_PER_MEMO", () => {
    const newCampaign = makeAction({
      tool: "propose_new_campaign",
      args: { name: "NewC", type: "search", initial_daily_budget: 30, target_keywords: ["a"], landing_page_url: "/x", conversion_action_ids: ["ca1"] },
    })
    const shift1 = makeAction({
      rank: 2,
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 20 }, // applies to a 400-budget campaign → $80 new
    })
    const signals = makeSignals()
    signals.raw!.campaigns[0].daily_budget_usd = 400
    const results = applyGuardrailsBatch([newCampaign, shift1], signals)
    expect(results[0].kind).toBe("pass")
    expect(results[1].kind).toBe("reject")
    if (results[1].kind === "reject") expect(results[1].reason).toMatch(/total.*spend.*cap/i)
  })
})

describe("soft guardrails — significance", () => {
  it("flags sig when proportion delta passes z=1.96 with adequate sample", () => {
    // CTR before: 50/1000 = 5%; after: 100/1000 = 10%; z ≈ 4.0 — clearly sig.
    expect(computeSignificance({
      kind: "proportion",
      before: { successes: 50, trials: 1000 },
      after: { successes: 100, trials: 1000 },
    })).toBe("sig")
  })

  it("flags underpowered when sample is large but delta is tiny", () => {
    expect(computeSignificance({
      kind: "proportion",
      before: { successes: 100, trials: 1000 },
      after: { successes: 102, trials: 1000 },
    })).toBe("underpowered")
  })

  it("flags insufficient_data when either side < SIG_MIN_SAMPLE", () => {
    expect(computeSignificance({
      kind: "proportion",
      before: { successes: 5, trials: 50 },
      after: { successes: 10, trials: 50 },
    })).toBe("insufficient_data")
  })
})

describe("soft guardrails — audit confidence", () => {
  it("high when data passes AND sig AND prior similar action succeeded", () => {
    expect(computeAuditConfidence({
      dataVolumeOk: true,
      significance: "sig",
      priorSimilarSucceeded: true,
    })).toBe("high")
  })

  it("medium when 2 of 3 are true", () => {
    expect(computeAuditConfidence({
      dataVolumeOk: true,
      significance: "sig",
      priorSimilarSucceeded: false,
    })).toBe("medium")
  })

  it("low when 0 or 1 are true", () => {
    expect(computeAuditConfidence({
      dataVolumeOk: false,
      significance: "underpowered",
      priorSimilarSucceeded: false,
    })).toBe("low")
  })
})
