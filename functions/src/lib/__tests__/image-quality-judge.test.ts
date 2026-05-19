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
  it("returns a 1-10 score and reasons array parsed from JSON output, judge_failed=false", async () => {
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
    expect(result.judge_failed).toBe(false)
  })

  it("returns score 0 with judge_failed=true on parse failure", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(0)
    expect(result.judge_failed).toBe(true)
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

  it("clamps a negative score to 1 (not 0, which is reserved for judge_failed)", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ score: -3, reasons: [] }) }],
    })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(1)
    expect(result.judge_failed).toBe(false)
  })

  it("strips bare ``` fences (no language tag) from model output", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "```\n" + JSON.stringify({ score: 9, reasons: ["x"] }) + "\n```" }],
    })
    const result = await judgeImageQuality({
      buffer: Buffer.from("x"),
      mime: "image/webp",
      originalPrompt: "p",
    })
    expect(result.score).toBe(9)
    expect(result.judge_failed).toBe(false)
  })

  it("exposes the retry threshold for the orchestrator", () => {
    expect(QUALITY_RETRY_THRESHOLD).toBe(7)
  })
})
