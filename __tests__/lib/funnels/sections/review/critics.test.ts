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
import type { RenderedPage } from "@/lib/funnels/render-image"

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

  it("shows each critic the SAME page when there is no render", async () => {
    // WHEN THERE IS NO RENDER — which is what `runCritics(DOC, [])` is, and
    // what every degrade path is: no browser, launch failure, screenshot
    // failure, render disabled.
    //
    // The three messages were once identical on EVERY turn, so that two critics
    // agreeing meant two lenses reaching the same conclusion rather than one
    // having been shown more. This branch deliberately amended that: the art
    // lens's own message now additionally carries `renderNote()` when there are
    // pictures attached to its call. What survives the amendment is what this
    // test pins — the three see the same DOCUMENT and the same deterministic
    // findings, the art lens is the ONLY one that ever diverges, and it
    // diverges ONLY when there is a render to diverge about. Off that path the
    // three calls are still byte-identical, so nothing about the old guarantee
    // is lost on the turns it used to cover.
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

const RENDER: RenderedPage = {
  images: [
    { mediaType: "image/png", data: "AAAA" },
    { mediaType: "image/png", data: "BBBB" },
  ],
  height: 2000,
  truncated: false,
  typographyFaithful: true,
  dynamicRegions: ["signup (a form)"],
  error: null,
}

describe("who gets to see the page", () => {
  it("marks exactly one lens as seeing the render", () => {
    // Derived from the table, never hand-listed: adding a fourth critic must
    // not silently start sending it pictures.
    expect(CRITICS.filter((lens) => lens.seesRender)).toHaveLength(1)
    expect(CRITICS.find((lens) => lens.seesRender)?.source).toBe("art")
  })

  it("passes images to the art critic and to nobody else", async () => {
    // Assert the ARGUMENT OBJECT of each call, not that the call happened.
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)

    expect(callAgent).toHaveBeenCalledTimes(3)
    const byLens = new Map(
      callAgent.mock.calls.map((call) => {
        const lens = CRITICS.find((candidate) => candidate.system === call[0])
        return [lens?.source, call[3]]
      }),
    )
    expect(byLens.get("art")?.images).toHaveLength(2)
    expect(byLens.get("copy")).not.toHaveProperty("images")
    expect(byLens.get("conversion")).not.toHaveProperty("images")
  })

  it("tells the art critic how many pictures there are and where they came from", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)
    const artCall = callAgent.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art",
    )
    expect(artCall?.[1]).toMatch(/whole-page view/i)
    // The others must not be told about pictures they cannot see.
    const copyCall = callAgent.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "copy",
    )
    expect(copyCall?.[1]).not.toMatch(/whole-page view/i)
  })

  it("warns the art critic when the page was cut off", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], { ...RENDER, truncated: true })
    const artCall = callAgent.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art",
    )
    expect(artCall?.[1]).toMatch(/not the end of the page/i)
  })

  it("is byte-identical to today when no render is supplied", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [])
    for (const call of callAgent.mock.calls) {
      expect(call[3]).not.toHaveProperty("images")
      expect(call[1]).not.toMatch(/whole-page view/i)
    }
  })

  it("sends no images when the render failed, even though it was supplied", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], { ...RENDER, images: [], error: "no browser available for rendering" })
    for (const call of callAgent.mock.calls) {
      expect(call[3]).not.toHaveProperty("images")
    }
  })
})

describe("the bands that are blank only in the picture", () => {
  // `reassemble` emits every interactive region as an empty placeholder div
  // that only the real page fills, and the renderer screenshots with no
  // scripts. Told nothing, the art critic filed those as high-severity empty
  // bands and the reviser replaced a working live testimonial feed — carrying a
  // real athlete's quote — with one it invented, attributed to a named person
  // with a made-up 40-yard-dash time, and reported that to the owner as a fix.
  const artMessage = () =>
    callAgent.mock.calls.find((call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art")?.[1] as
      | string
      | undefined

  it("names them, with the section each one is in", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], { ...RENDER, dynamicRegions: ["signup (a form)", "proof (a live testimonial feed)"] })
    expect(artMessage()).toContain("signup (a form)")
    expect(artMessage()).toContain("proof (a live testimonial feed)")
  })

  it("tells the critic not to call them empty and not to invent content for them", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)
    expect(artMessage()).toMatch(/do not report any of them as empty/i)
    expect(artMessage()).toMatch(/do not write a quote, a name, a number/i)
  })

  it("says the opposite when the page has none — an empty band there is real", async () => {
    // The absence control. A note that always warns about blank regions would
    // teach the critic to ignore the genuinely empty band this whole feature
    // exists to catch.
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], { ...RENDER, dynamicRegions: [] })
    expect(artMessage()).not.toMatch(/NOT in the pictures/i)
    expect(artMessage()).toMatch(/nothing on this page is filled in later/i)
  })

  it("keeps the warning out of the lenses that have no pictures", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)
    for (const call of callAgent.mock.calls) {
      if (CRITICS.find((lens) => lens.system === call[0])?.source === "art") continue
      expect(call[1]).not.toContain("signup (a form)")
    }
  })
})

describe("the art director's brief", () => {
  it("forbids findings about the typeface", () => {
    // Three of five FONT_STACKS pairings resolve to system faces that differ
    // per platform, so the faces in the picture are not the faces a visitor
    // sees. A finding about them would be confidently wrong.
    const art = CRITICS.find((lens) => lens.source === "art")!
    expect(art.system).toMatch(/never file a finding about the typeface/i)
  })

  it("still tells the critic to stay out of the other lanes", () => {
    const art = CRITICS.find((lens) => lens.source === "art")!
    expect(art.system).toMatch(/other two reviewers/i)
  })

  // -------------------------------------------------------------------------
  // THE BRIEF IS A CACHED PREFIX. It is sent on EVERY art call, including every
  // documented degrade — no browser on the box, a launch that failed, a
  // screenshot that timed out — where nothing is attached at all. It used to
  // open "YOU HAVE PICTURES. Screenshots ... are attached", and on a real
  // document with no render 5 of 5 art findings then cited "the screenshot"
  // and described colours, gaps and spacing nobody had shown the model.
  //
  // So: unconditionally PRESENT, conditionally RELEVANT. The claim that
  // pictures exist is per-turn content and belongs in the user message, which
  // is also where Anthropic's strict-prefix cache needs it to be.
  // -------------------------------------------------------------------------
  const PICTURE_CLAIMS = [
    /\byou have\s+(?:pictures|screenshots|images)\b/gi,
    /(?:screenshots?|pictures?|images?)[^.]{0,90}?\b(?:are|is)\s+attached\b/gi,
    /\battached\b[^.]{0,40}?\b(?:screenshots?|pictures?|images?)\b/gi,
  ]

  it("never states that pictures exist except under a condition", () => {
    const art = CRITICS.find((lens) => lens.source === "art")!
    for (const pattern of PICTURE_CLAIMS) {
      for (const match of art.system.matchAll(pattern)) {
        const index = match.index ?? 0
        // The sentence the claim sits in: back to the previous full stop or
        // line break, forward to the end of the claim.
        const start = Math.max(art.system.lastIndexOf(".", index), art.system.lastIndexOf("\n", index))
        const sentence = art.system.slice(start + 1, index + match[0].length)
        expect(sentence.toLowerCase(), `unconditional claim: "${sentence.trim()}"`).toMatch(/\b(when|if)\b/)
      }
    }
  })

  it("mentions pictures at all — the control for the assertion above", () => {
    // An "every claim is conditional" check passes trivially on a brief that
    // never mentions pictures, which would be a different bug (the one lens
    // with eyes not knowing it has them).
    const art = CRITICS.find((lens) => lens.source === "art")!
    expect(art.system).toMatch(/screenshots/i)
  })
})

describe("what the art critic is told on a turn with no render", () => {
  it("says nothing about screenshots it was not sent", async () => {
    // The observed confabulation: with no pictures the lens still wrote "in the
    // screenshot this band reads as nearly empty whitespace…".
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [])
    const artCall = callAgent.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art",
    )
    expect(artCall?.[1]).not.toMatch(/screenshot|picture|attached/i)
  })

  it("does say so on a turn that HAS one — the presence control", async () => {
    callAgent.mockResolvedValue({ content: { findings: [] }, tokens_used: 1 })
    await runCritics(DOC, [], RENDER)
    const artCall = callAgent.mock.calls.find(
      (call) => CRITICS.find((lens) => lens.system === call[0])?.source === "art",
    )
    expect(artCall?.[1]).toMatch(/screenshots of this page are attached to this message/i)
  })
})
