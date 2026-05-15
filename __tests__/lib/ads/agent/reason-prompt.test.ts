import { describe, it, expect } from "vitest"
import { buildAdsReasonUserMessage } from "@/lib/ads/agent/reason"
import type { AdsSignals } from "@/lib/ads/agent/types"

function emptySignals(): AdsSignals {
  return {
    generated_at: "2026-05-15T00:00:00Z",
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
    tool_performance: [],
    few_shots: [],
  }
}

describe("buildAdsReasonUserMessage", () => {
  it("omits the tool-performance block when tool_performance is empty", () => {
    const msg = buildAdsReasonUserMessage(emptySignals())
    expect(msg).not.toContain("Tool performance")
    // Snapshot JSON is still appended.
    expect(msg).toContain('"generated_at"')
  })

  it("renders the tool-performance block when populated", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "propose_new_keywords",
        n_measured: 12,
        avg_impact_score: 35,
        p95_abs_delta: 18.4,
        success_rate: 0.75,
      },
      {
        tool: "propose_negative_keywords",
        n_measured: 8,
        avg_impact_score: -10,
        p95_abs_delta: 4.2,
        success_rate: 0.3,
      },
    ]
    const msg = buildAdsReasonUserMessage(signals)
    expect(msg).toContain("Tool performance (last 90 days, your channel):")
    expect(msg).toContain("propose_new_keywords")
    expect(msg).toContain("avg impact +35")
    expect(msg).toContain("12 runs")
    expect(msg).toContain("75% success")
    expect(msg).toContain("propose_negative_keywords")
    expect(msg).toContain("avg impact -10")
    expect(msg).toContain("30% success")
    expect(msg).toContain("Bias your ranking toward tools with positive avg_impact")
  })

  it("prepends the tool-performance block before the JSON snapshot", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "propose_budget_shift",
        n_measured: 3,
        avg_impact_score: 12,
        p95_abs_delta: 2.1,
        success_rate: 0.66,
      },
    ]
    const msg = buildAdsReasonUserMessage(signals)
    const perfIdx = msg.indexOf("Tool performance")
    const jsonIdx = msg.indexOf('"generated_at"')
    expect(perfIdx).toBeGreaterThan(-1)
    expect(jsonIdx).toBeGreaterThan(-1)
    expect(perfIdx).toBeLessThan(jsonIdx)
  })

  it("renders the brief block before the tool-performance block when both are present", () => {
    const signals = emptySignals()
    signals.brief_context = {
      brief_id: "b1",
      week_of: "2026-05-11",
      themes: [{ tag: "rotational-power", weight: 0.8 }],
      audience_focus: "intermediate lifters",
      priority_channel: "ads",
      keywords_to_chase: ["med ball throw"],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
    }
    signals.tool_performance = [
      {
        tool: "propose_new_keywords",
        n_measured: 5,
        avg_impact_score: 22,
        p95_abs_delta: 9,
        success_rate: 0.6,
      },
    ]
    const msg = buildAdsReasonUserMessage(signals)
    const briefIdx = msg.indexOf("Brief context")
    const perfIdx = msg.indexOf("Tool performance")
    expect(briefIdx).toBeGreaterThan(-1)
    expect(perfIdx).toBeGreaterThan(briefIdx)
  })

  it("uses '+0' formatting when avg_impact_score is exactly zero", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "flag_for_human",
        n_measured: 4,
        avg_impact_score: 0,
        p95_abs_delta: 0,
        success_rate: 0.5,
      },
    ]
    const msg = buildAdsReasonUserMessage(signals)
    expect(msg).toContain("avg impact +0")
    expect(msg).toContain("50% success")
  })

  it("omits the few-shots block when few_shots is empty", () => {
    const msg = buildAdsReasonUserMessage(emptySignals())
    expect(msg).not.toContain("Recent winners")
  })

  it("renders the few-shots block when few_shots is populated", () => {
    const signals = emptySignals()
    signals.few_shots = [
      "negative_keywords saved $48/wk on broad-match 'shoulder pain'",
      "budget_shift +20% to Comeback Code Search lifted CVR to 7.2%",
    ]
    const msg = buildAdsReasonUserMessage(signals)
    expect(msg).toContain(
      "Recent winners (for inspiration only — do not copy verbatim):",
    )
    expect(msg).toContain("  1. negative_keywords saved $48/wk")
    expect(msg).toContain("  2. budget_shift +20%")
  })

  it("renders few-shots after tool_performance and before the JSON snapshot", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "propose_budget_shift",
        n_measured: 3,
        avg_impact_score: 12,
        p95_abs_delta: 2.1,
        success_rate: 0.66,
      },
    ]
    signals.few_shots = ["winner caption"]
    const msg = buildAdsReasonUserMessage(signals)
    const perfIdx = msg.indexOf("Tool performance")
    const winnersIdx = msg.indexOf("Recent winners")
    const jsonIdx = msg.indexOf('"generated_at"')
    expect(perfIdx).toBeGreaterThan(-1)
    expect(winnersIdx).toBeGreaterThan(perfIdx)
    expect(jsonIdx).toBeGreaterThan(winnersIdx)
  })
})
