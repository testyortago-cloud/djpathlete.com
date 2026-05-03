import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-test",
}))

import { extractImagePrompts } from "../image-prompts.js"
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
