import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-test",
  MODEL_SONNET_5: "claude-sonnet-5-test",
}))

import { extractImagePrompts, sectionExcerpts, BRAND_TREATMENT, PROMPT_VERSION } from "../image-prompts.js"
import * as anthropic from "../anthropic.js"

const mockCallAgent = vi.mocked(anthropic.callAgent)

describe("extractImagePrompts", () => {
  beforeEach(() => {
    mockCallAgent.mockReset()
  })

  it("returns hero + inline prompts validated by schema", async () => {
    mockCallAgent.mockResolvedValueOnce({
      content: {
        hero_prompt: "An athlete sprinting on a track at golden hour, photorealistic",
        inline_prompts: [
          { section_h2: "Force-Velocity Profiling", prompt: "Coach reading sport-science chart, gym setting" },
          { section_h2: "Velocity-Based Training", prompt: "Barbell mid-press with chains, photorealistic" },
        ],
      },
      tokens_used: 500,
    })

    const result = await extractImagePrompts({
      title: "Eccentric Overload",
      content: "<h2>Force-Velocity Profiling</h2><p>...</p>",
      category: "Performance",
      qualifyingSections: ["Force-Velocity Profiling", "Velocity-Based Training"],
    })

    expect(result.hero_prompt.length).toBeGreaterThan(10)
    expect(result.inline_prompts).toHaveLength(2)
    expect(result.inline_prompts[0].section_h2).toBe("Force-Velocity Profiling")
  })

  it("propagates errors from callAgent", async () => {
    mockCallAgent.mockRejectedValueOnce(new Error("Claude failed"))
    await expect(
      extractImagePrompts({
        title: "x",
        content: "<p>x</p>",
        category: "Performance",
        qualifyingSections: [],
      }),
    ).rejects.toThrow("Claude failed")
  })

  it("BRAND_TREATMENT is exported and contains DJP visual fingerprints", () => {
    expect(BRAND_TREATMENT).toContain("DJP visual treatment")
    expect(BRAND_TREATMENT.toLowerCase()).toContain("documentary")
  })

  it("BRAND_TREATMENT uses photographer/lens/film vocabulary, not marketing copy", () => {
    expect(BRAND_TREATMENT).toMatch(/35mm|50mm|85mm/i)
    expect(BRAND_TREATMENT).toMatch(/Kodak Portra|Fuji Pro|Cinestill/i)
    expect(BRAND_TREATMENT).toMatch(/Walter Iooss|Annie Leibovitz|Platon|Joey Terrill/i)
  })

  it("BRAND_TREATMENT contains an explicit anti-AI artifact list", () => {
    expect(BRAND_TREATMENT).toMatch(/plastic skin/i)
    expect(BRAND_TREATMENT).toMatch(/extra fingers|deformed hands/i)
    expect(BRAND_TREATMENT).toMatch(/over.?saturated|HDR/i)
  })

  it("BRAND_TREATMENT specifies diversity baseline", () => {
    expect(BRAND_TREATMENT).toMatch(/mix of|varying|range of/i)
  })

  it("exports PROMPT_VERSION as a monotonically incremented string for logging", () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+$/)
  })

  it("passes the category through to the user message so prompts can specialize", async () => {
    mockCallAgent.mockResolvedValueOnce({
      content: {
        hero_prompt: "h".repeat(20),
        inline_prompts: [{ section_h2: "Section A", prompt: "i".repeat(20) }],
      },
      tokens_used: 100,
    })
    await extractImagePrompts({
      title: "T",
      content: "C",
      category: "Rotational",
      qualifyingSections: ["Section A"],
    })
    const userMsg = mockCallAgent.mock.calls[0][1] as string
    expect(userMsg).toContain("Category: Rotational")
  })

  it("injects the category style module into the user message", async () => {
    mockCallAgent.mockResolvedValueOnce({
      content: {
        hero_prompt: "h".repeat(20),
        inline_prompts: [{ section_h2: "Section A", prompt: "i".repeat(20) }],
      },
      tokens_used: 100,
    })
    await extractImagePrompts({
      title: "T",
      content: "C",
      category: "Rotational",
      qualifyingSections: ["Section A"],
    })
    const userMsg = mockCallAgent.mock.calls[0][1] as string
    expect(userMsg).toMatch(/CATEGORY-SPECIFIC STYLE MODULE/)
    expect(userMsg).toMatch(/medicine ball|cable column/i)
  })

  it("filters inline_prompts to only those matching qualifyingSections", async () => {
    mockCallAgent.mockResolvedValueOnce({
      content: {
        hero_prompt: "hero prompt",
        inline_prompts: [
          { section_h2: "Real Section", prompt: "p1 prompt" },
          { section_h2: "Hallucinated Section", prompt: "p2 prompt" },
        ],
      },
      tokens_used: 100,
    })

    const result = await extractImagePrompts({
      title: "x",
      content: "x",
      category: "Performance",
      qualifyingSections: ["Real Section"],
    })

    expect(result.inline_prompts).toHaveLength(1)
    expect(result.inline_prompts[0].section_h2).toBe("Real Section")
  })
})

// Owner's report, 2026-09-29: "Sports Rehab Has a Methodology Problem" (filed
// under Recovery) came back with a man in a recliner and a woman eating salad.
describe("extractImagePrompts — what the prompt writer is shown", () => {
  const reply = {
    content: { hero_prompt: "h".repeat(20), inline_prompts: [] },
    tokens_used: 100,
  }

  // A long post: the section we care about starts well past 4000 characters,
  // which is where the old `content.slice(0, 4000)` stopped.
  const filler = `<p>${"Load management matters. ".repeat(250)}</p>`
  const html =
    `<p>Most athletes treat sports rehab like a waiting room.</p>` +
    `<h2>The Phases That Actually Matter</h2>${filler}` +
    `<h2>Nutrition <em>Belongs</em> Inside the Rehab Protocol</h2>` +
    `<p>You can't out-train a catabolic environment. During tissue repair the demand for protein rises.</p>`

  beforeEach(() => {
    mockCallAgent.mockReset()
    mockCallAgent.mockResolvedValueOnce(reply)
  })

  it("shows the start of a section that sits past the old 4000-character cut", async () => {
    // MUTANT: go back to input.content.slice(0, 4000) — the nutrition text is gone.
    expect(html.indexOf("catabolic")).toBeGreaterThan(4000)
    await extractImagePrompts({
      title: "Sports Rehab: What Actually Gets You Back",
      content: html,
      category: "Recovery",
      qualifyingSections: ["The Phases That Actually Matter", "Nutrition  Belongs  Inside the Rehab Protocol"],
    })
    const userMsg = mockCallAgent.mock.calls[0][1] as string
    // The key is findQualifyingSections' own string (tags become spaces), so
    // the excerpt lands under the exact heading the model must echo back.
    expect(userMsg).toContain(
      "## Nutrition  Belongs  Inside the Rehab Protocol\nYou can't out-train a catabolic environment.",
    )
    expect(userMsg).toContain("Most athletes treat sports rehab like a waiting room.")
    expect(userMsg).not.toContain("<p>")
  })

  it("uses the rehab style for a rehab post filed under Recovery", async () => {
    // MUTANT: getCategoryStyleModule(input.category) — the Recovery module,
    // "home environments … Not gym equipment", which drew the recliner.
    await extractImagePrompts({
      title: "Sports Rehab: What Actually Gets You Back",
      content: html,
      category: "Recovery",
      qualifyingSections: [],
    })
    const userMsg = mockCallAgent.mock.calls[0][1] as string
    expect(userMsg).toContain("CATEGORY MODULE — Comeback / return-to-play / post-injury")
    expect(userMsg).not.toContain("CATEGORY MODULE — Recovery and sleep")
  })

  it("keeps the Recovery style for a Recovery post that is not about rehab", async () => {
    // Presence control: the override must not swallow the whole category.
    await extractImagePrompts({
      title: "Why Sleep Is Your Best Recovery Tool",
      content: "<p>Sleep.</p>",
      category: "Recovery",
      qualifyingSections: [],
    })
    const userMsg = mockCallAgent.mock.calls[0][1] as string
    expect(userMsg).toContain("CATEGORY MODULE — Recovery and sleep")
  })
})

describe("sectionExcerpts", () => {
  it("keys each section by its heading as findQualifyingSections reports it", async () => {
    const { findQualifyingSections } = await import("../../lib/html-splice.js")
    const html =
      `<h2> Sleep &amp; <strong>Recovery</strong> </h2><p>${"word ".repeat(200)}</p>` +
      `<h2>Second</h2><p>${"more ".repeat(200)}</p>`
    const qualifying = findQualifyingSections(html)
    expect(qualifying.length).toBe(2)
    const { sections } = sectionExcerpts(html)
    for (const q of qualifying) {
      expect(sections.has(q.h2Text)).toBe(true)
    }
  })
})
