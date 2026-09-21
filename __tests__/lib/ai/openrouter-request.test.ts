import { describe, it, expect } from "vitest"
import {
  buildChatRequest,
  buildSystemMessage,
  buildUserMessage,
  buildToolChoice,
  buildResponseFormat,
  normalizeUsage,
  STRUCTURED_OUTPUT_NAME,
} from "@/lib/ai/openrouter-request"
import { toOpenRouterModel, toReasoningEffort, shouldFallBackToAnthropic } from "@/lib/ai/openrouter"

const SCHEMA = { type: "object", properties: { a: { type: "string" } } } as Record<string, unknown>

describe("toOpenRouterModel", () => {
  it.each([
    ["claude-opus-4-6", "anthropic/claude-opus-4.6"],
    ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
    ["claude-fable-5-1", "anthropic/claude-fable-5.1"],
    // Anthropic's dated suffix has no counterpart in the OpenRouter slug.
    ["claude-haiku-4-5-20251001", "anthropic/claude-haiku-4.5"],
  ])("maps %s to %s", (native, slug) => {
    expect(toOpenRouterModel(native)).toBe(slug)
  })

  it("THROWS on an unmapped model rather than passing the id through", () => {
    // A passthrough would 404 at OpenRouter, the fallback would read that as a
    // provider fault, and every call would quietly be served by direct
    // Anthropic — a migration that looks done while nothing has moved.
    expect(() => toOpenRouterModel("claude-sonnet-9")).toThrow(/No OpenRouter slug/)
  })
})

describe("toReasoningEffort", () => {
  it.each([
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
  ] as const)("passes %s through", (input, expected) => {
    expect(toReasoningEffort(input)).toBe(expected)
  })

  it("collapses Anthropic's 'max' to 'high', which OpenRouter understands", () => {
    expect(toReasoningEffort("max")).toBe("high")
  })
})

describe("buildSystemMessage", () => {
  it("stays a plain string when caching is off", () => {
    expect(buildSystemMessage("sys", false)).toEqual({ role: "system", content: "sys" })
  })

  it("becomes content parts carrying a cache breakpoint when caching is on", () => {
    // A plain string cannot carry cache_control, so caching REQUIRES parts.
    expect(buildSystemMessage("sys", true)).toEqual({
      role: "system",
      content: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
    })
  })
})

describe("buildUserMessage", () => {
  it("stays a plain string when there is nothing but the message", () => {
    expect(buildUserMessage("hello")).toEqual({ role: "user", content: "hello" })
  })

  it("puts the cached prefix BEFORE the variable message", () => {
    // Everything before the breakpoint must be byte-identical between calls.
    // Reversing these two keeps working and silently drops the hit rate to 0.
    const msg = buildUserMessage("variable", "stable")
    const parts = msg.content as Array<{ type: string; text?: string }>
    expect(parts.map((p) => p.text)).toEqual(["stable", "variable"])
    expect(parts[0]).toHaveProperty("cache_control", { type: "ephemeral" })
    expect(parts[1]).not.toHaveProperty("cache_control")
  })

  it("orders documents, then images, then prefix, then message", () => {
    const msg = buildUserMessage(
      "msg",
      "prefix",
      [{ media_type: "image/png", data: "IMG" }],
      [{ media_type: "application/pdf", data: "PDF" }],
    )
    const parts = msg.content as Array<{ type: string }>
    expect(parts.map((p) => p.type)).toEqual(["file", "image_url", "text", "text"])
  })

  it("encodes images as data URLs", () => {
    const msg = buildUserMessage("m", undefined, [{ media_type: "image/jpeg", data: "AAAA" }])
    const parts = msg.content as Array<{ type: string; image_url?: { url: string } }>
    expect(parts[0].image_url?.url).toBe("data:image/jpeg;base64,AAAA")
  })

  it("encodes PDFs as file parts with a data URL", () => {
    const msg = buildUserMessage("m", undefined, undefined, [{ media_type: "application/pdf", data: "BBBB" }])
    const parts = msg.content as Array<{ type: string; file?: { filename: string; file_data: string } }>
    expect(parts[0].file?.file_data).toBe("data:application/pdf;base64,BBBB")
    expect(parts[0].file?.filename).toBe("document-1.pdf")
  })
})

describe("structured output", () => {
  it("nests the tool name under `function`, as OpenAI requires", () => {
    // Anthropic spells this {type:"tool", name}. Sending that spelling is not
    // rejected — it just does not force anything, and the model answers prose.
    expect(buildToolChoice()).toEqual({ type: "function", function: { name: STRUCTURED_OUTPUT_NAME } })
  })

  it("does not request strict json_schema mode", () => {
    // Strict mode demands additionalProperties:false and every property
    // required; the Zod-generated schemas satisfy neither, so strict would be
    // rejected outright. Zod still validates the result.
    expect(buildResponseFormat(SCHEMA).json_schema.strict).toBe(false)
  })
})

describe("buildChatRequest", () => {
  const base = { modelId: "claude-sonnet-4-6", systemPrompt: "sys", userMessage: "usr", maxTokens: 100 }

  it("uses tools + forced tool_choice by default", () => {
    const body = buildChatRequest({ ...base, schema: SCHEMA })
    expect(body.tool_choice).toEqual({ type: "function", function: { name: STRUCTURED_OUTPUT_NAME } })
    expect(body.response_format).toBeUndefined()
  })

  it("uses response_format instead when the model refuses forced tool choice", () => {
    const body = buildChatRequest({ ...base, schema: SCHEMA, useResponseFormat: true })
    expect(body.response_format).toBeDefined()
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
  })

  it("sends no tools or response_format when there is no schema", () => {
    const body = buildChatRequest({ ...base, schema: null })
    expect(body.tools).toBeUndefined()
    expect(body.response_format).toBeUndefined()
  })

  it("maps effort onto reasoning.effort", () => {
    const body = buildChatRequest({ ...base, schema: SCHEMA, effort: "medium" })
    expect(body.reasoning).toEqual({ effort: "medium" })
  })

  it("omits reasoning entirely when no effort was asked for", () => {
    // Sending reasoning to a model that does not support it is a needless way
    // to turn a working call into a 400.
    const body = buildChatRequest({ ...base, schema: SCHEMA })
    expect(body.reasoning).toBeUndefined()
  })

  it("translates the model id rather than passing it through", () => {
    expect(buildChatRequest({ ...base, schema: SCHEMA }).model).toBe("anthropic/claude-sonnet-4.6")
  })
})

describe("normalizeUsage", () => {
  it("does NOT add cached tokens to the prompt total — they are already in it", () => {
    // Anthropic reports cache counters alongside input_tokens; OpenRouter
    // reports them INSIDE prompt_tokens. Adding them here double-counts every
    // cached call, which would quietly inflate every token figure we log.
    const u = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 50 },
    })
    expect(u.tokens_used).toBe(1200)
    expect(u.cache_read_tokens).toBe(800)
    expect(u.cache_creation_tokens).toBe(50)
  })

  it("reports zeroes rather than NaN when usage is missing", () => {
    expect(normalizeUsage(undefined)).toEqual({
      tokens_used: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    })
  })
})

describe("shouldFallBackToAnthropic", () => {
  it.each([
    ["no status (network/DNS)", {}],
    ["401 bad key", { status: 401 }],
    ["402 out of credit", { status: 402 }],
    ["429 rate limited", { status: 429 }],
    ["500 provider error", { status: 500 }],
    ["503 unavailable", { status: 503 }],
  ])("falls back on %s", (_label, err) => {
    expect(shouldFallBackToAnthropic(err)).toBe(true)
  })

  it("does NOT fall back on a 400 — we built a bad request", () => {
    // The same request fails identically on Anthropic, so falling back doubles
    // the cost of the bug and hides it behind a working response.
    expect(shouldFallBackToAnthropic({ status: 400 })).toBe(false)
  })

  it("does NOT fall back on 404 — a bad model slug is our bug, not an outage", () => {
    expect(shouldFallBackToAnthropic({ status: 404 })).toBe(false)
  })

  it("does NOT fall back on an abort — that is the caller's deadline", () => {
    expect(shouldFallBackToAnthropic({ name: "AbortError" })).toBe(false)
  })
})
