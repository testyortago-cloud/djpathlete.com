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
    })
    expect(msg).toContain("Week of: 2026-05-18")
    expect(msg).toContain("rotational-power")
    expect(msg).toContain("double down on rotational power")
  })
})
