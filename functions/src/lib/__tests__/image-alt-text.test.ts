import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Anthropic SDK before importing the helper
const mockCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { generateAltText } from "../image-alt-text.js"

describe("generateAltText", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  it("returns alt text from Claude Vision response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"alt_text":"A barbell back squat at the bottom position"}' }],
    })
    const buffer = Buffer.from("fakeimage")
    const alt = await generateAltText(buffer, "image/webp")
    expect(alt).toBe("A barbell back squat at the bottom position")
  })

  it("truncates alt text to 180 chars", async () => {
    const longText = "a".repeat(300)
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ alt_text: longText }) }],
    })
    const alt = await generateAltText(Buffer.from("x"), "image/webp")
    expect(alt.length).toBeLessThanOrEqual(180)
  })

  it("returns empty string on parse failure", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not json at all" }],
    })
    const alt = await generateAltText(Buffer.from("x"), "image/webp")
    expect(alt).toBe("")
  })

  it("strips markdown fences from response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '```json\n{"alt_text":"Athlete sprinting on track"}\n```' }],
    })
    const alt = await generateAltText(Buffer.from("x"), "image/webp")
    expect(alt).toBe("Athlete sprinting on track")
  })
})
