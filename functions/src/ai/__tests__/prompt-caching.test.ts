import { describe, it, expect, vi, beforeEach } from "vitest"

const streamMock = vi.hoisted(() => vi.fn())

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: { stream: streamMock },
  })) as unknown as { new (): unknown } & { APIError: typeof APIError }
  ;(Anthropic as unknown as { APIError: typeof APIError }).APIError = APIError
  return { default: Anthropic, Anthropic }
})

import { callAgent } from "../anthropic.js"
import { z } from "zod"

describe("callAgent prompt-cache token surfacing", () => {
  beforeEach(() => {
    streamMock.mockReset()
  })

  it("returns cache_creation_tokens and cache_read_tokens from usage", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 4000,
          cache_read_input_tokens: 0,
        },
      }),
    })

    const schema = z.object({ ok: z.boolean() })
    const result = await callAgent("sys", "user", schema, { cacheSystemPrompt: true })

    expect(result.tokens_used).toBe(150)
    expect(result.cache_creation_tokens).toBe(4000)
    expect(result.cache_read_tokens).toBe(0)
  })

  it("treats missing cache fields as zero", async () => {
    streamMock.mockReturnValue({
      finalMessage: async () => ({
        content: [{ type: "tool_use", input: { ok: true } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    })

    const schema = z.object({ ok: z.boolean() })
    const result = await callAgent("sys", "user", schema)

    expect(result.cache_creation_tokens).toBe(0)
    expect(result.cache_read_tokens).toBe(0)
  })
})
