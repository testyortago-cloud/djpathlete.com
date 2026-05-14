import { describe, it, expect } from "vitest"
import { buildCriticUserMessage, CRITIC_SYSTEM_PROMPT } from "../strategy/critic-prompt.js"

describe("critic prompt", () => {
  it("system prompt instructs JSON-only cross-channel synthesis", () => {
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/cross-channel/i)
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/JSON only/i)
  })

  it("user message embeds counts and attribution", () => {
    const msg = buildCriticUserMessage({
      weekOf: "2026-05-09",
      seoMemos: [{ id: "s1" } as never],
      adsMemos: [],
      socialMemos: [{ id: "x1" } as never, { id: "x2" } as never],
      attribution: { seo: { bookings: 3 } },
      funnel: { visits: 100, signups: 12, bookings: 4, payments: 3 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(msg).toContain("Week of: 2026-05-09")
    expect(msg).toContain("SEO memos: 1")
    expect(msg).toContain("Social memos: 2")
    expect(msg).toContain("seo")
  })
})
