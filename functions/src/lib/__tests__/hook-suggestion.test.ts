import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

describe("suggestHookFromTranscript (functions twin)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  it("returns a cleaned hook when Claude returns one line", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "5 Mistakes Killing Your Change-of-Direction Speed" }],
    })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    const hook = await suggestHookFromTranscript("A long transcript about agility and cutting mechanics.")
    expect(hook).toBe("5 Mistakes Killing Your Change-of-Direction Speed")
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it("strips surrounding quotes and a markdown fence", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '```\n"Why your agility drills aren\'t working"\n```' }],
    })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("transcript")).toBe("Why your agility drills aren't working")
  })

  it("caps the hook at 80 characters", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "a".repeat(200) }] })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    const hook = await suggestHookFromTranscript("transcript")
    expect(hook).not.toBeNull()
    expect(hook!.length).toBeLessThanOrEqual(80)
  })

  it("returns null for an empty/whitespace transcript without calling the API", async () => {
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("")).toBeNull()
    expect(await suggestHookFromTranscript("   \n ")).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns null when the API call throws", async () => {
    mockCreate.mockRejectedValue(new Error("network"))
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("transcript")).toBeNull()
  })

  it("returns null when the model returns empty text", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "   " }] })
    const { suggestHookFromTranscript } = await import("../hook-suggestion.js")
    expect(await suggestHookFromTranscript("transcript")).toBeNull()
  })
})
