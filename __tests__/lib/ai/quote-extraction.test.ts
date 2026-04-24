import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

describe("extractQuotesFromTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  it("returns parsed quotes when Claude returns a valid JSON array", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            "The body keeps score when the mind forgets.",
            "Rotation is where strength meets control.",
            "Your hips don't lie — your tape does.",
          ]),
        },
      ],
    })
    const { extractQuotesFromTranscript } = await import("@/lib/ai/quote-extraction")
    const quotes = await extractQuotesFromTranscript(
      "This is a long transcript about rotational athletics and core control.",
      3,
    )
    expect(quotes).toEqual([
      "The body keeps score when the mind forgets.",
      "Rotation is where strength meets control.",
      "Your hips don't lie — your tape does.",
    ])
    expect(mockCreate).toHaveBeenCalledOnce()
    const args = mockCreate.mock.calls[0][0]
    expect(args.model).toBe("claude-sonnet-4-6")
    // The prompt should reference the count and transcript
    expect(JSON.stringify(args.messages)).toContain("transcript")
  })

  it("returns [] when Claude's response isn't parseable JSON", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "sorry, I can't extract quotes" }],
    })
    const { extractQuotesFromTranscript } = await import("@/lib/ai/quote-extraction")
    const quotes = await extractQuotesFromTranscript("x", 3)
    expect(quotes).toEqual([])
  })

  it("returns [] when transcript is empty or whitespace", async () => {
    const { extractQuotesFromTranscript } = await import("@/lib/ai/quote-extraction")
    expect(await extractQuotesFromTranscript("", 5)).toEqual([])
    expect(await extractQuotesFromTranscript("   \n  ", 5)).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("truncates quotes longer than 140 chars", async () => {
    const long = "a".repeat(200)
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify([long]) }],
    })
    const { extractQuotesFromTranscript } = await import("@/lib/ai/quote-extraction")
    const quotes = await extractQuotesFromTranscript("some transcript", 1)
    expect(quotes[0].length).toBeLessThanOrEqual(140)
  })

  it("respects the requested count — takes first N quotes", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify(["a", "b", "c", "d", "e", "f"]),
        },
      ],
    })
    const { extractQuotesFromTranscript } = await import("@/lib/ai/quote-extraction")
    const quotes = await extractQuotesFromTranscript("x", 3)
    expect(quotes).toEqual(["a", "b", "c"])
  })
})
