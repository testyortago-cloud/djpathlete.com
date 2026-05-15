import { describe, it, expect } from "vitest"
import { buildSeoReasonUserMessage } from "../seo/reason.js"
import type { SeoSignalsSummary } from "../seo/signals.js"

function emptySignals(): SeoSignalsSummary {
  return {
    gsc_28d: {
      total_clicks: 0,
      total_impressions: 0,
      avg_position: 0,
      top_winnable: [],
      top_decayed: [],
    },
    inventory: { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 },
    recent_tavily: [],
    orphan_post_ids: [],
    last_8_memos_outcomes: [],
    gsc_distinct_dates: 28,
    brief_context: null,
    tool_performance: [],
  }
}

describe("buildSeoReasonUserMessage", () => {
  it("omits the tool-performance block when tool_performance is empty", () => {
    const msg = buildSeoReasonUserMessage(emptySignals())
    expect(msg).not.toContain("Tool performance")
    expect(msg).toContain("Pick the two highest-leverage actions")
  })

  it("renders the tool-performance block when populated", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "queue_new_post",
        n_measured: 12,
        avg_impact_score: 35,
        p95_abs_delta: 18.4,
        success_rate: 0.75,
      },
      {
        tool: "queue_refresh",
        n_measured: 8,
        avg_impact_score: -10,
        p95_abs_delta: 4.2,
        success_rate: 0.3,
      },
    ]
    const msg = buildSeoReasonUserMessage(signals)
    expect(msg).toContain("Tool performance (last 90 days, your channel):")
    expect(msg).toContain("queue_new_post")
    expect(msg).toContain("avg impact +35")
    expect(msg).toContain("12 runs")
    expect(msg).toContain("75% success")
    expect(msg).toContain("queue_refresh")
    expect(msg).toContain("avg impact -10")
    expect(msg).toContain("30% success")
    expect(msg).toContain("Bias your ranking toward tools with positive avg_impact")
  })

  it("prepends the tool-performance block before the JSON payload", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "queue_internal_link_sweep",
        n_measured: 3,
        avg_impact_score: 12,
        p95_abs_delta: 2.1,
        success_rate: 0.66,
      },
    ]
    const msg = buildSeoReasonUserMessage(signals)
    const perfIdx = msg.indexOf("Tool performance")
    const jsonIdx = msg.indexOf("```json")
    expect(perfIdx).toBeGreaterThan(-1)
    expect(jsonIdx).toBeGreaterThan(-1)
    expect(perfIdx).toBeLessThan(jsonIdx)
  })

  it("still includes the brief block when a brief is present, before tool_performance", () => {
    const signals = emptySignals()
    signals.brief_context = {
      brief_id: "b1",
      week_of: "2026-05-11",
      themes: [{ tag: "rotational-power", weight: 0.8 }],
      audience_focus: "intermediate lifters",
      priority_channel: "seo",
      keywords_to_chase: ["med ball throw"],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
    }
    signals.tool_performance = [
      {
        tool: "queue_new_post",
        n_measured: 5,
        avg_impact_score: 22,
        p95_abs_delta: 9,
        success_rate: 0.6,
      },
    ]
    const msg = buildSeoReasonUserMessage(signals)
    const briefIdx = msg.indexOf("Brief context")
    const perfIdx = msg.indexOf("Tool performance")
    expect(briefIdx).toBeGreaterThan(-1)
    expect(perfIdx).toBeGreaterThan(briefIdx)
  })

  it("omits the critique block when no critique_objections are passed", () => {
    const msg = buildSeoReasonUserMessage(emptySignals())
    expect(msg).not.toContain("A second model raised these objections")
  })

  it("renders critique objections after tool_performance and before the JSON payload", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "queue_refresh",
        n_measured: 8,
        avg_impact_score: -10,
        p95_abs_delta: 4.2,
        success_rate: 0.3,
      },
    ]
    const msg = buildSeoReasonUserMessage(signals, {
      critique_objections: [
        "queue_refresh underperformed in last 90d",
        "no inventory data for the chosen keyword",
      ],
    })
    expect(msg).toContain("A second model raised these objections to your prior plan:")
    expect(msg).toContain("  - queue_refresh underperformed in last 90d")
    expect(msg).toContain("  - no inventory data for the chosen keyword")
    expect(msg).toContain("Reconsider. You may keep the plan with stronger justification, or revise it.")

    const perfIdx = msg.indexOf("Tool performance")
    const critiqueIdx = msg.indexOf("A second model")
    const jsonIdx = msg.indexOf("```json")
    expect(perfIdx).toBeGreaterThan(-1)
    expect(critiqueIdx).toBeGreaterThan(perfIdx)
    expect(jsonIdx).toBeGreaterThan(critiqueIdx)
  })

  it("omits the critique block when critique_objections is an empty array", () => {
    const msg = buildSeoReasonUserMessage(emptySignals(), { critique_objections: [] })
    expect(msg).not.toContain("A second model raised these objections")
  })

  it("omits the few-shots block when few_shots is empty or undefined", () => {
    const msgUndefined = buildSeoReasonUserMessage(emptySignals())
    expect(msgUndefined).not.toContain("Recent winners")
    const msgEmpty = buildSeoReasonUserMessage(emptySignals(), { few_shots: [] })
    expect(msgEmpty).not.toContain("Recent winners")
  })

  it("renders the few-shots block when few_shots is populated", () => {
    const msg = buildSeoReasonUserMessage(emptySignals(), {
      few_shots: [
        "queue_refresh on rotational-power post bumped impressions 38%",
        "internal_link_sweep into deload-weeks lifted position 3 -> 1.4",
      ],
    })
    expect(msg).toContain(
      "Recent winners (for inspiration only — do not copy verbatim):",
    )
    expect(msg).toContain("  1. queue_refresh on rotational-power post")
    expect(msg).toContain("  2. internal_link_sweep into deload-weeks")
  })

  it("renders the few-shots block after tool_performance and before the JSON payload", () => {
    const signals = emptySignals()
    signals.tool_performance = [
      {
        tool: "queue_new_post",
        n_measured: 4,
        avg_impact_score: 22,
        p95_abs_delta: 9,
        success_rate: 0.6,
      },
    ]
    const msg = buildSeoReasonUserMessage(signals, {
      few_shots: ["winner caption"],
    })
    const perfIdx = msg.indexOf("Tool performance")
    const winnersIdx = msg.indexOf("Recent winners")
    const jsonIdx = msg.indexOf("```json")
    expect(perfIdx).toBeGreaterThan(-1)
    expect(winnersIdx).toBeGreaterThan(perfIdx)
    expect(jsonIdx).toBeGreaterThan(winnersIdx)
  })
})
