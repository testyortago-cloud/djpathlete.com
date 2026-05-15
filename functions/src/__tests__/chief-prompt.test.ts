import { describe, it, expect } from "vitest"
import { buildChiefUserMessage, CHIEF_SYSTEM_PROMPT } from "../strategy/chief-prompt.js"

describe("chief prompt", () => {
  it("system prompt instructs JSON-only StrategyBrief output", () => {
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/StrategyBrief/i)
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/JSON only/i)
  })

  it("user message embeds latest signal + prior brief themes", () => {
    const msg = buildChiefUserMessage({
      weekOf: "2026-05-18",
      latestSignal: {
        id: "s1",
        week_of: "2026-05-11",
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: ["double down on rotational power"],
        preflight_status: "ok",
        preflight_reasons: [],
        rationale: "x",
        created_at: "2026-05-11T13:00:00Z",
      },
      priorBriefs: [
        {
          id: "b0",
          themes: [{ tag: "rotational-power", weight: 0.8 }],
        } as never,
      ],
      toolPerformanceByChannel: { seo: [], ads: [], social: [] },
    })
    expect(msg).toContain("Week of: 2026-05-18")
    expect(msg).toContain("rotational-power")
    expect(msg).toContain("double down on rotational power")
  })

  it("system prompt instructs Chief to bias priority_channel on tool_performance", () => {
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/tool_performance/)
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/warm-up/)
  })

  it("user message embeds the per-channel tool performance block", () => {
    const msg = buildChiefUserMessage({
      weekOf: "2026-05-18",
      latestSignal: {
        id: "s1",
        week_of: "2026-05-11",
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: [],
        preflight_status: "ok",
        preflight_reasons: [],
        rationale: "x",
        created_at: "2026-05-11T13:00:00Z",
      },
      priorBriefs: [],
      toolPerformanceByChannel: {
        seo: [{ tool: "topical_map", n_measured: 12, avg_impact_score: 0, success_rate: 0.66 }],
        ads: [],
        social: [],
      },
    })
    expect(msg).toContain("Cross-channel tool performance")
    expect(msg).toContain("topical_map")
    expect(msg).toContain("0.66")
  })

  it("omits the few-shots block when fewShots is empty or omitted", () => {
    const base = {
      weekOf: "2026-05-18",
      latestSignal: {
        id: "s1",
        week_of: "2026-05-11",
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: [],
        preflight_status: "ok" as const,
        preflight_reasons: [],
        rationale: "x",
        created_at: "2026-05-11T13:00:00Z",
      },
      priorBriefs: [],
      toolPerformanceByChannel: { seo: [], ads: [], social: [] },
    }
    const msgOmitted = buildChiefUserMessage(base)
    expect(msgOmitted).not.toContain("Recent winners")
    const msgEmpty = buildChiefUserMessage({ ...base, fewShots: [] })
    expect(msgEmpty).not.toContain("Recent winners")
  })

  it("renders the few-shots block before the trailing JSON-only instruction", () => {
    const msg = buildChiefUserMessage({
      weekOf: "2026-05-18",
      latestSignal: {
        id: "s1",
        week_of: "2026-05-11",
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: [],
        preflight_status: "ok",
        preflight_reasons: [],
        rationale: "x",
        created_at: "2026-05-11T13:00:00Z",
      },
      priorBriefs: [],
      toolPerformanceByChannel: { seo: [], ads: [], social: [] },
      fewShots: [
        "rotational-power theme with med-ball-throw CTA pulled 4 bookings",
        "comeback-code positioning hooked golfers 50+",
      ],
    })
    expect(msg).toContain(
      "Recent winners (for inspiration only — do not copy verbatim):",
    )
    expect(msg).toContain("rotational-power theme with med-ball-throw")
    const winnersIdx = msg.indexOf("Recent winners")
    const tailIdx = msg.indexOf("Return JSON only")
    expect(winnersIdx).toBeGreaterThan(-1)
    expect(tailIdx).toBeGreaterThan(winnersIdx)
  })
})
