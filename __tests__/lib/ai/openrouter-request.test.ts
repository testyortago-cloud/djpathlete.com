import { describe, it, expect } from "vitest"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import {
  buildChatRequest,
  buildSystemMessage,
  buildUserMessage,
  buildToolChoice,
  buildResponseFormat,
  normalizeUsage,
  STRUCTURED_OUTPUT_NAME,
} from "@/lib/ai/openrouter-request"
import {
  toOpenRouterModel,
  toReasoningEffort,
  shouldFallBackToAnthropic,
  canFallBackToAnthropic,
  ProviderFallbackError,
} from "@/lib/ai/openrouter"

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
    // A bare status-less object is NOT in this list any more — see the
    // "does NOT fall back on OUR OWN bug" case below for why.
    ["network refusal", { code: "ECONNREFUSED" }],
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
    expect(shouldFallBackToAnthropic(new DOMException("This operation was aborted", "AbortError"))).toBe(false)
  })

  it("does NOT fall back on either SDK's REAL APIUserAbortError, whose .name is only 'Error'", () => {
    const openaiAbort = new OpenAI.APIUserAbortError()
    const anthropicAbort = new Anthropic.APIUserAbortError()
    expect(openaiAbort.name).toBe("Error")
    expect(shouldFallBackToAnthropic(openaiAbort)).toBe(false)
    expect(shouldFallBackToAnthropic(anthropicAbort)).toBe(false)
  })

  it("does NOT fall back on an abort even when its cause chain carries a socket errno", () => {
    // The caller's deadline wins over whatever the socket was doing when it
    // was cut: an abort is never a reason to spend more time on another provider.
    const abort = Object.assign(new OpenAI.APIUserAbortError(), {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    })
    expect(shouldFallBackToAnthropic(abort)).toBe(false)
  })

  it("falls back on a socket-level errno", () => {
    expect(shouldFallBackToAnthropic({ code: "ECONNREFUSED" })).toBe(true)
    expect(shouldFallBackToAnthropic({ code: "UND_ERR_CONNECT_TIMEOUT" })).toBe(true)
  })

  // The SDK's connection classes never set `.name` (it reads "Error"), and
  // carry neither `.status` nor `.code`. The first version of these tests faked
  // `{ name: "APIConnectionError" }`, which is not what production throws — so
  // a real unreachable OpenRouter never fell back while the suite stayed green.
  it("falls back on the REAL OpenAI APIConnectionError, which has no name, status or code of its own", () => {
    const err = new OpenAI.APIConnectionError({ cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) })
    expect(err.name).toBe("Error")
    expect(err.status).toBeUndefined()
    expect(err.code).toBeUndefined()
    expect(shouldFallBackToAnthropic(err)).toBe(true)
  })

  it("falls back on the REAL OpenAI APIConnectionTimeoutError, which has no cause at all", () => {
    const err = new OpenAI.APIConnectionTimeoutError()
    expect(err.name).toBe("Error")
    expect(err.cause).toBeUndefined()
    expect(shouldFallBackToAnthropic(err)).toBe(true)
  })

  it("recognises the classes from ANOTHER copy of the SDK, where instanceof is false", async () => {
    // functions/ installs its own openai, so the same class exists twice. An
    // error from the other copy fails `instanceof` against this one, which is
    // why the class NAME is read as well.
    const other = await import("../../../functions/node_modules/openai/index.mjs")
    const timeout = new other.APIConnectionTimeoutError()
    const abort = new other.APIUserAbortError()
    expect(timeout).not.toBeInstanceOf(OpenAI.APIConnectionError)
    expect(abort).not.toBeInstanceOf(OpenAI.APIUserAbortError)

    expect(shouldFallBackToAnthropic(timeout)).toBe(true)
    expect(shouldFallBackToAnthropic(Object.assign(abort, { cause: { code: "ECONNRESET" } }))).toBe(false)
  })

  it("reads the errno from the cause chain — undici's 'fetch failed' carries it one level down", () => {
    // What a raw fetch (or the SDK's connection error) actually looks like:
    // TypeError("fetch failed") whose .cause is the socket error with the code.
    const socket = Object.assign(new Error("connect ECONNREFUSED 104.18.2.115:443"), { code: "ECONNREFUSED" })
    const fetchFailed = new TypeError("fetch failed", { cause: socket })
    expect(shouldFallBackToAnthropic(fetchFailed)).toBe(true)
    expect(shouldFallBackToAnthropic(new Error("wrapped", { cause: fetchFailed }))).toBe(true)
  })

  it("does not follow a cause chain forever", () => {
    const a = new Error("a") as Error & { cause?: unknown }
    const b = new Error("b", { cause: a })
    a.cause = b
    expect(shouldFallBackToAnthropic(a)).toBe(false)
  })

  it("does NOT fall back on a status-less error whose cause is not a socket errno", () => {
    const ours = new TypeError("Cannot read properties of undefined", {
      cause: Object.assign(new Error("bad arg"), { code: "ERR_INVALID_ARG_TYPE" }),
    })
    expect(shouldFallBackToAnthropic(ours)).toBe(false)
  })

  it("does NOT fall back on OUR OWN bug that happens to carry no status", () => {
    // This is the important one. The first version returned true for anything
    // status-less, so a TypeError in the request builder — or the "No
    // OpenRouter slug" throw — read as "provider unreachable" and every
    // affected call was quietly served by Anthropic. The migration looks done,
    // the bill moves, and nothing says why.
    expect(shouldFallBackToAnthropic(new TypeError("x is not a function"))).toBe(false)
    expect(shouldFallBackToAnthropic(new Error('No OpenRouter slug for model "claude-sonnet-9"'))).toBe(false)
  })
})

describe("canFallBackToAnthropic", () => {
  it.each(["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-5", "claude-fable-5-1"])(
    "lets the Claude model %s fall back",
    (model) => {
      expect(canFallBackToAnthropic(model)).toBe(true)
    },
  )

  it.each(["gpt-6-astra", "gpt-6-astra-pro"])("refuses %s, which only OpenRouter can serve", (model) => {
    // gpt-6-astra is the program architect and exercise selector default. Sent
    // to Anthropic it answers a 404, and THAT error would replace the
    // OpenRouter fault the owner actually needed to see.
    expect(canFallBackToAnthropic(model)).toBe(false)
  })
})

describe("ProviderFallbackError", () => {
  const openRouter = Object.assign(new Error("429 Rate limit exceeded"), { status: 429 })
  const anthropic = Object.assign(
    new Error('400 {"type":"error","error":{"message":"Your credit balance is too low to access the Anthropic API."}}'),
    { status: 400 },
  )

  it("LEADS with the OpenRouter error, so a dead fallback cannot hide it", () => {
    // The owner saw only Anthropic's credit-balance message and concluded the
    // migration had never happened. When both providers fail, the primary one
    // is the story; the fallback's failure is a footnote.
    const err = new ProviderFallbackError(openRouter, anthropic)
    expect(err.message.indexOf("OpenRouter")).toBe(0)
    expect(err.message).toContain("429 Rate limit exceeded")
    expect(err.message.indexOf("429 Rate limit exceeded")).toBeLessThan(err.message.indexOf("credit balance"))
  })

  it("still says the fallback failed, and why", () => {
    const err = new ProviderFallbackError(openRouter, anthropic)
    expect(err.message).toMatch(/Anthropic fallback also failed/)
    expect(err.message).toContain("credit balance is too low")
  })

  it("carries the OpenRouter status, so retry logic classifies the PRIMARY fault", () => {
    // A 429 must stay retryable. Carrying Anthropic's 400 instead would end the
    // retry loop on a fault that was never about our request.
    expect(new ProviderFallbackError(openRouter, anthropic).status).toBe(429)
  })

  it("has no status when the OpenRouter error had none (a socket error)", () => {
    const socket = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    expect(new ProviderFallbackError(socket, anthropic).status).toBeUndefined()
  })

  it("keeps both originals for logging", () => {
    const err = new ProviderFallbackError(openRouter, anthropic)
    expect(err.openRouterError).toBe(openRouter)
    expect(err.anthropicError).toBe(anthropic)
    expect(err.cause).toBe(openRouter)
  })

  it("does not double the period when OpenRouter's own message already ends in one", () => {
    // Measured live: an invalid key answers "401 User not found." — and the
    // owner reads this message in the chat bubble.
    const err = new ProviderFallbackError(Object.assign(new Error("401 User not found."), { status: 401 }), anthropic)
    expect(err.message).toMatch(/^OpenRouter failed: 401 User not found\. The Anthropic fallback also failed: /)
    expect(err.message).not.toContain("..")
  })

  it("describes non-Error throwables without crashing", () => {
    const err = new ProviderFallbackError({ status: 503 }, "boom")
    expect(err.message).toMatch(/^OpenRouter failed/)
    expect(err.message).toContain("boom")
    expect(err.status).toBe(503)
  })
})
