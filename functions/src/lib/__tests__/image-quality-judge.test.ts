import { describe, it, expect, vi, beforeEach } from "vitest"

const createMock = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: createMock } },
}))

import { judgeImageQuality, QUALITY_RETRY_THRESHOLD } from "../image-quality-judge.js"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "x"
})

describe("judgeImageQuality", () => {
  it("returns a 1-10 score and reasons array parsed from JSON output", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ score: 8, reasons: ["sharp", "on brand"] }) }],
    })

    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })

    expect(result.score).toBe(8)
    expect(result.reasons).toEqual(["sharp", "on brand"])
  })

  it("returns score 0 on parse failure so callers know to retry once and move on", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(0)
  })

  it("clamps scores to 1-10", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ score: 15, reasons: [] }) }],
    })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(10)
  })

  it("exposes the retry threshold for the orchestrator", () => {
    expect(QUALITY_RETRY_THRESHOLD).toBe(7)
  })
})
