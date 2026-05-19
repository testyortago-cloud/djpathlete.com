import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-test",
}))

import { extractImagePrompts, BRAND_TREATMENT, PROMPT_VERSION } from "../image-prompts.js"
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
