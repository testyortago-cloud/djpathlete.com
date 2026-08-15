// __tests__/lib/funnels/sections/review/critics.test.ts
//
// Two things are worth protecting here and neither is the prompt text.
//
// One: the panel must never take the turn down. It runs after the owner's page
// is already saved, so a provider outage should cost them a less thorough
// review and nothing else.
//
// Two: the three lenses must actually be three. A panel that degrades into one
// prompt run three times is the failure mode this design exists to avoid, and
// it is invisible at runtime — you get three findings that agree, which looks
// like corroboration.

import { describe, expect, it, vi, beforeEach } from "vitest"

const callAgent = vi.fn()
vi.mock("@/lib/ai/anthropic", () => ({
  callAgent: (...args: unknown[]) => callAgent(...args),
}))

import { CRITICS, runCritics } from "@/lib/funnels/sections/review/critics"
import { SECTION_REVIEW_CRITIC_MAX_TOKENS, SECTION_REVIEW_CRITIC_MODEL } from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"

const DOC: SectionDoc = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "accent", radius: "soft" },
  sections: [
    {
      id: "hero",
      kind: "hero",
      variant: "centered",
      style: {},
      props: { headline: "Hi", primaryCta: { label: "Go", target: { kind: "booking" } } },
    },
  ],
} as SectionDoc

function reply(code: string) {
  return {
    content: {
      findings: [{ code, severity: "medium", sectionIds: ["hero"], issue: "issue text", suggestion: "do this" }],
    },
    usage: {},
  }
}

const AUDIT_FINDING: Finding = {
  code: "tone-run",
  severity: "high",
  sectionIds: ["a", "b"],
  issue: "a seam that is not there",
  suggestion: "retone one of them",
  source: "audit",
}

beforeEach(() => {
  callAgent.mockReset()
})

describe("the panel", () => {
  it("runs all three lenses", async () => {
    callAgent.mockImplementation(() => Promise.resolve(reply("x")))
    await runCritics(DOC, [])
    expect(callAgent).toHaveBeenCalledTimes(3)
  })

  it("runs them in parallel, not one after another", async () => {
    // The whole reason the panel is affordable. In series this stage costs
    // three round trips instead of one.
    let inFlight = 0
    let peak = 0
    callAgent.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return reply("x")
    })
    await runCritics(DOC, [])
    expect(peak).toBe(3)
  })

  it("asks each critic a DIFFERENT question", async () => {
    callAgent.mockImplementation(() => Promise.resolve(reply("x")))
    await runCritics(DOC, [])
    const systems = callAgent.mock.calls.map((call) => call[0] as string)
    expect(new Set(systems).size).toBe(3)
  })

  it("shows each critic the SAME page", async () => {
    // The lens lives entirely in the system prompt. If the user messages
    // differed, two critics agreeing would prove nothing — one of them might
    // simply have been shown more.
    callAgent.mockImplementation(() => Promise.resolve(reply("x")))
    await runCritics(DOC, [])
    const messages = callAgent.mock.calls.map((call) => call[1] as string)
    expect(new Set(messages).size).toBe(1)
  })

  it("uses the critic model and budget, never the caller defaults", async () => {
    callAgent.mockImplementation(() => Promise.resolve(reply("x")))
    await runCritics(DOC, [])
    for (const call of callAgent.mock.calls) {
      expect(call[3]).toMatchObject({
        model: SECTION_REVIEW_CRITIC_MODEL,
        maxTokens: SECTION_REVIEW_CRITIC_MAX_TOKENS,
      })
    }
  })

  it("gives the critics the deterministic findings so they do not rediscover them", async () => {
    callAgent.mockImplementation(() => Promise.resolve(reply("x")))
    await runCritics(DOC, [AUDIT_FINDING])
    expect(callAgent.mock.calls[0][1]).toContain("tone-run")
    expect(callAgent.mock.calls[0][1]).toContain("a seam that is not there")
  })
})

describe("the source stamp", () => {
  it("comes from the CALLER, not from the model", async () => {
    callAgent.mockImplementation(() => Promise.resolve(reply("x")))
    const found = await runCritics(DOC, [])
    expect(new Set(found.findings.map((f) => f.source))).toEqual(new Set(["art", "copy", "conversion"]))
  })

  it("is not overridable by a model that returns its own source", async () => {
    // A model labelling itself as another critic would make the merge collapse
    // two independent observations into one.
    callAgent.mockImplementation(() =>
      Promise.resolve({
        content: {
          findings: [
            { code: "x", severity: "low", sectionIds: [], issue: "i", suggestion: "s", source: "audit" },
          ],
        },
        usage: {},
      }),
    )
    const found = await runCritics(DOC, [])
    expect(found.findings.every((f) => f.source !== "audit")).toBe(true)
  })
})

describe("failure containment", () => {
  it("survives one critic throwing and keeps the other two", async () => {
    callAgent
      .mockImplementationOnce(() => Promise.reject(new Error("boom")))
      .mockImplementation(() => Promise.resolve(reply("x")))
    const found = await runCritics(DOC, [])
    expect(found.findings).toHaveLength(2)
  })

  it("returns an empty list — never throws — when all three fail", async () => {
    callAgent.mockImplementation(() => Promise.reject(new Error("provider down")))
    await expect(runCritics(DOC, [])).resolves.toMatchObject({ findings: [] })
  })

  it("does not let one failure discard the successes", async () => {
    // Promise.all would. This is the assertion that pins allSettled.
    callAgent
      .mockImplementationOnce(() => Promise.resolve(reply("first")))
      .mockImplementationOnce(() => Promise.reject(new Error("boom")))
      .mockImplementationOnce(() => Promise.resolve(reply("third")))
    const found = await runCritics(DOC, [])
    expect(found.findings.map((f) => f.code).sort()).toEqual(["first", "third"])
  })
})

describe("the lenses", () => {
  it("are three, with three distinct sources", () => {
    expect(CRITICS).toHaveLength(3)
    expect(new Set(CRITICS.map((c) => c.source)).size).toBe(3)
  })

  it("have genuinely different briefs, not one brief with the name swapped", () => {
    expect(new Set(CRITICS.map((c) => c.system)).size).toBe(3)
  })

  it("each tell the critic to stay out of the other two lanes", () => {
    // Without this the panel silently degenerates into three general critics
    // reporting the same finding, which reads as corroboration.
    for (const critic of CRITICS) {
      expect(critic.system).toMatch(/other two reviewers/i)
    }
  })

  it("each permit an empty finding list", () => {
    // A critic that always finds three things churns a good page.
    for (const critic of CRITICS) {
      expect(critic.system).toMatch(/empty list/i)
    }
  })

  it("name only section kinds that exist in the registry", async () => {
    const { SECTION_KINDS } = await import("@/lib/funnels/sections/registry")
    for (const critic of CRITICS) {
      const listed = critic.system.match(/kinds are: ([^.]+)\./)
      if (!listed) continue
      const named = listed[1].split(",").map((entry) => entry.trim())
      for (const kind of named) {
        expect(SECTION_KINDS).toContain(kind)
      }
    }
  })
})
