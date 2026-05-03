import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCallAgent = vi.hoisted(() => vi.fn())

vi.mock("../../ai/anthropic.js", () => ({
  callAgent: mockCallAgent,
  MODEL_SONNET: "claude-sonnet-test",
}))

import { getAnchorsForSuggestions } from "../internal-link-anchors.js"

describe("internal-link-anchors", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the Claude-proposed anchors on success", async () => {
    mockCallAgent.mockResolvedValue({
      content: {
        anchors: [
          { slug: "comeback-code", anchor_text: "rest days", section_h2: "Recovery basics" },
        ],
      },
      tokens_used: 80,
    })
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<h2>Recovery basics</h2><p>Get rest days.</p>" },
      suggestions: [{ slug: "comeback-code", title: "Comeback Code post" }],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      slug: "comeback-code",
      anchor_text: "rest days",
      section_h2: "Recovery basics",
    })
  })

  it("caps at 3 entries even when Claude returns more", async () => {
    mockCallAgent.mockResolvedValue({
      content: {
        anchors: [
          { slug: "a", anchor_text: "x", section_h2: "A" },
          { slug: "b", anchor_text: "y", section_h2: "B" },
          { slug: "c", anchor_text: "z", section_h2: "C" },
          { slug: "d", anchor_text: "w", section_h2: "D" },
        ],
      },
      tokens_used: 100,
    })
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [
        { slug: "a", title: "A" },
        { slug: "b", title: "B" },
        { slug: "c", title: "C" },
        { slug: "d", title: "D" },
      ],
    })
    expect(result).toHaveLength(3)
  })

  it("returns empty array when no suggestions provided", async () => {
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [],
    })
    expect(result).toEqual([])
    expect(mockCallAgent).not.toHaveBeenCalled()
  })

  it("returns empty array on Claude error", async () => {
    mockCallAgent.mockRejectedValue(new Error("rate limit"))
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [{ slug: "a", title: "A" }],
    })
    expect(result).toEqual([])
  })

  it("filters out anchors whose slug doesn't match a suggestion (Claude hallucination guard)", async () => {
    mockCallAgent.mockResolvedValue({
      content: {
        anchors: [
          { slug: "comeback-code", anchor_text: "rest", section_h2: "Recovery" },
          { slug: "rotational-reboot", anchor_text: "throw", section_h2: "Drills" },
        ],
      },
      tokens_used: 80,
    })
    const result = await getAnchorsForSuggestions({
      targetPost: { title: "T", content: "<p>x</p>" },
      suggestions: [{ slug: "comeback-code", title: "C" }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe("comeback-code")
  })
})
