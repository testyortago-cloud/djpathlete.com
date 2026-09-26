import { describe, it, expect } from "vitest"
import { buildCriticUserMessage, CRITIC_SYSTEM_PROMPT } from "../strategy/critic-prompt.js"
import { CHIEF_SYSTEM_PROMPT } from "../strategy/chief-prompt.js"

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
      attribution: { newsletter: { sessions: 30, leads: 3 } },
      funnel: { sessions: 100, leads: 12 },
      priorSignals: [],
      voiceFlags: [],
    })
    expect(msg).toContain("Week of: 2026-05-09")
    expect(msg).toContain("SEO memos: 1")
    expect(msg).toContain("Social memos: 2")
    expect(msg).toContain("newsletter")
  })

  // G41. The attribution the critic receives is sessions and leads per
  // first-touch channel. A prompt that still told the model to read bookings
  // and revenue "via marketing_attribution" invites it to invent them.
  it("says what the attribution measures and what it does not", () => {
    expect(CRITIC_SYSTEM_PROMPT).not.toMatch(/bookings \+ revenue via marketing_attribution/i)
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/sessions/i)
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/leads/i)
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/does not measure bookings or revenue/i)
    expect(CRITIC_SYSTEM_PROMPT).not.toMatch(/"bookings": <int>, "revenue": <num>/)
    // G41 review: rows exist only for tagged and /go/ landings, so organic
    // site traffic is invisible, and CAC cannot be computed from any of it.
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/untagged/i)
    expect(CRITIC_SYSTEM_PROMPT).not.toMatch(/CAC/)
  })

  it("the Chief Strategist's prompt no longer reads attribution_summary as bookings and revenue", () => {
    expect(CHIEF_SYSTEM_PROMPT).not.toMatch(/Bookings \+ revenue, not vanity engagement\. Use the signal's attribution_summary/)
    expect(CHIEF_SYSTEM_PROMPT).toMatch(/attribution_summary[^.]*sessions and leads/i)
  })
})
