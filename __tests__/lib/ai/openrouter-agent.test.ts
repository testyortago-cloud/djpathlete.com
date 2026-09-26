// @vitest-environment node
//
// callAgentViaOpenRouter streams (chat.completions.stream().finalChatCompletion()),
// and the openai SDK reports a fault that arrives MID-stream as
// `new APIError(undefined, data.error)`: status undefined, OpenRouter's number
// only in `.code`. Unlifted, a mid-stream 502 read as status-less — neither
// callAgent's retry nor the Anthropic fallback would touch it, so one upstream
// hiccup ended a program generation. Every fault here is built from the SDK's
// REAL error classes, which never set `.name`.
import { describe, it, expect, vi, beforeEach } from "vitest"
import OpenAI from "openai"
import { z } from "zod"

const h = vi.hoisted(() => ({ stream: vi.fn(), finalChatCompletion: vi.fn() }))

vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openrouter")>()
  return {
    ...actual,
    getOpenRouterClient: () => ({
      chat: {
        completions: {
          stream: (body: unknown, options?: unknown) => {
            h.stream(body, options)
            return { finalChatCompletion: h.finalChatCompletion }
          },
        },
      },
    }),
  }
})

import { callAgentViaOpenRouter } from "@/lib/ai/openrouter-agent"
import { shouldFallBackToAnthropic } from "@/lib/ai/openrouter"
import { STRUCTURED_OUTPUT_NAME } from "@/lib/ai/openrouter-request"

const schema = z.object({ answer: z.string() })
const toolSchema = { type: "object", properties: { answer: { type: "string" } } }

function call() {
  return callAgentViaOpenRouter("claude-sonnet-4-6", "sys", "usr", schema, toolSchema, (d) => d, {
    maxTokens: 1000,
  })
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error("expected the call to throw")
}

beforeEach(() => {
  h.stream.mockReset()
  h.finalChatCompletion.mockReset()
})

describe("callAgentViaOpenRouter — a fault that arrives mid-stream", () => {
  it("answers from the stream's final completion (the path the lift wraps still works)", async () => {
    h.finalChatCompletion.mockResolvedValueOnce({
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: STRUCTURED_OUTPUT_NAME, arguments: '{"answer":"ok"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const res = await call()

    expect(res.content).toEqual({ answer: "ok" })
    expect(res.tokens_used).toBe(8)
    expect(h.stream).toHaveBeenCalledOnce()
  })

  it("lifts a mid-stream 502 onto .status, so it is retried and falls back like any 502", async () => {
    const midStream = new OpenAI.APIError(
      undefined,
      { code: 502, message: "Provider returned error" },
      undefined,
      undefined,
    )
    // The premise, from the real class: no status, the number only in .code,
    // and — unlifted — the fallback classifier reads it as our own bug.
    expect(midStream.status).toBeUndefined()
    expect(midStream.code).toBe(502)
    expect(shouldFallBackToAnthropic(midStream)).toBe(false)
    h.finalChatCompletion.mockRejectedValueOnce(midStream)

    const error = (await failureOf(call())) as Error & { status?: number }

    expect(error.status).toBe(502)
    expect(shouldFallBackToAnthropic(error)).toBe(true)
    expect(error.message).toContain("Provider returned error")
    expect(error.message).toContain("claude-sonnet-4-6")
    expect(error.cause).toBe(midStream)
  })

  it("leaves an error that already has a status untouched (a 429 before the first chunk)", async () => {
    const rateLimited = OpenAI.APIError.generate(
      429,
      { error: { message: "Rate limit exceeded" } },
      undefined,
      new Headers(),
    )
    h.finalChatCompletion.mockRejectedValueOnce(rateLimited)

    expect(await failureOf(call())).toBe(rateLimited)
  })

  it("leaves the caller's abort untouched, so it is still recognised as an abort and never retried", async () => {
    const abort = new OpenAI.APIUserAbortError()
    h.finalChatCompletion.mockRejectedValueOnce(abort)

    const error = await failureOf(call())

    expect(error).toBe(abort)
    expect(shouldFallBackToAnthropic(error)).toBe(false)
  })
})
