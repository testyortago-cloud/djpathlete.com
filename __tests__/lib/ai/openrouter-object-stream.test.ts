// streamObjectViaOpenRouter — the page builder's stream, moved off direct
// Anthropic (2026-09-26).
//
// THE CONTRACT UNDER TEST IS THE ROUTE'S, not the AI SDK's documentation.
// `app/api/admin/funnels/steps/[stepId]/build/route.ts` (`streamOneAttempt`)
// reads exactly four things from a stream: `text-delta` parts (counted as the
// live output meter), `object` parts (the page assembling on screen), the
// `finish` part's usage (the spend log), and `.object` (the answer, or a
// rejection it can recover a double-encoded payload from). Every assertion
// below is about one of those four; a replacement that satisfied the SDK's
// types but not these would ship a builder that spins, logs zero spend, or
// throws away answers the route used to rescue.
//
// The client is faked at `getOpenRouterClient`, so the REQUEST this module
// builds is asserted too — forced tool choice above all, because a request
// without it lets the model answer in prose and every turn fails downstream
// with a message about the content rather than the request.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"
import { NoObjectGeneratedError } from "ai"
import OpenAI from "openai"

const createMock = vi.fn()

vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openrouter")>()
  return {
    ...actual,
    getOpenRouterClient: () => ({ chat: { completions: { create: createMock } } }),
  }
})

import { streamObjectViaOpenRouter, streamWithAnthropicFallback } from "@/lib/ai/openrouter-object-stream"
import { shouldFallBackToAnthropic } from "@/lib/ai/openrouter"
import { describeModelError, recoverObjectFromError, recoverObjectFromValue } from "@/lib/ai/recover-object"

const schema = z.object({
  headline: z.string().max(80),
  bullets: z.array(z.string()).length(3),
})

const USAGE = {
  prompt_tokens: 1500,
  completion_tokens: 300,
  prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 200 },
  completion_tokens_details: { reasoning_tokens: 50 },
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "gen-test-1",
    model: "anthropic/claude-opus-5",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function usageChunk(usage: unknown) {
  return { id: "gen-test-1", model: "anthropic/claude-opus-5", choices: [], usage }
}

function fromChunks(chunks: unknown[], failWith?: unknown) {
  return (async function* () {
    for (const c of chunks) yield c
    if (failWith !== undefined) throw failWith
  })()
}

/** The shape OpenRouter streams a forced tool call in: name first, then argument fragments. */
function toolCallChunks(fragments: string[], opts: { finish?: string; usage?: unknown } = {}) {
  return [
    chunk({
      role: "assistant",
      tool_calls: [
        { index: 0, id: "call_1", type: "function", function: { name: "structured_output", arguments: "" } },
      ],
    }),
    ...fragments.map((fragment) => chunk({ tool_calls: [{ index: 0, function: { arguments: fragment } }] })),
    chunk({}, opts.finish ?? "tool_calls"),
    usageChunk(opts.usage ?? USAGE),
  ]
}

type Part = { type: string; [key: string]: unknown }

async function drain(stream: { fullStream: AsyncIterable<unknown> }): Promise<Part[]> {
  const parts: Part[] = []
  for await (const part of stream.fullStream) parts.push(part as Part)
  return parts
}

function start(overrides: Partial<Parameters<typeof streamObjectViaOpenRouter>[0]> = {}) {
  return streamObjectViaOpenRouter({
    modelId: "claude-opus-5",
    systemPrompt: "You write landing pages.",
    userMessage: "A strength coach's page.",
    schema,
    maxTokens: 2000,
    ...overrides,
  })
}

function statusError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

const FRAGMENTS = ['{"headline":"Bu', "ild str", 'ength"', "  ", ',"bullets":["a', '","b"', ',"c"]}']

beforeEach(() => {
  createMock.mockReset()
})

describe("streamObjectViaOpenRouter — what the route reads while the model writes", () => {
  it("emits a partial object after each argument delta that changed it, not one object at the end", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    const parts = await drain(start())

    const objects = parts.filter((p) => p.type === "object").map((p) => p.object)
    // Six, not seven: the whitespace-only delta parses to the same object and
    // must not produce a duplicate section event downstream.
    expect(objects).toEqual([
      { headline: "Bu" },
      { headline: "Build str" },
      { headline: "Build strength" },
      { headline: "Build strength", bullets: ["a"] },
      { headline: "Build strength", bullets: ["a", "b"] },
      { headline: "Build strength", bullets: ["a", "b", "c"] },
    ])
    // PROGRESSIVE, proved by order: the first object part arrives before the
    // last text delta. A stream that buffered everything and emitted objects
    // after the model finished would satisfy the list above and fail this.
    const types = parts.map((p) => p.type)
    expect(types.indexOf("object")).toBeLessThan(types.lastIndexOf("text-delta"))
    expect(types.at(-1)).toBe("finish")
  })

  it("emits one text-delta per argument delta, carrying that fragment", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    const parts = await drain(start())
    const deltas = parts.filter((p) => p.type === "text-delta").map((p) => p.textDelta)
    expect(deltas).toEqual(FRAGMENTS)
  })

  it("resolves .object to the schema-validated answer", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    const stream = start()
    await drain(stream)
    await expect(stream.object).resolves.toEqual({ headline: "Build strength", bullets: ["a", "b", "c"] })
  })

  // Forced tool choice should make structured_output the only call, but the
  // wire format allows several, each streaming its argument fragments under
  // its own `index` and interleaved with the others. Concatenating by arrival
  // order would splice two JSON documents into one — the meter would count the
  // other call's bytes and `.object` would reject a payload the model never wrote.
  function interleaved(order: { structured: number; other: number }) {
    const { structured, other } = order
    const named = [
      { index: structured, id: "call_1", type: "function", function: { name: "structured_output", arguments: "" } },
      { index: other, id: "call_2", type: "function", function: { name: "lookup_brand", arguments: "" } },
    ].sort((a, b) => a.index - b.index)
    const fragment = (index: number, text: string) => ({ index, function: { arguments: text } })
    return [
      chunk({ role: "assistant", tool_calls: named }),
      chunk({ tool_calls: [fragment(structured, '{"headline":"Bu')] }),
      chunk({ tool_calls: [fragment(other, '{"brand":')] }),
      // Both calls advancing in ONE delta, other first.
      chunk({ tool_calls: [fragment(other, '"djp"}'), fragment(structured, 'ild strength",')] }),
      chunk({ tool_calls: [fragment(structured, '"bullets":["a","b","c"]}')] }),
      chunk({}, "tool_calls"),
      usageChunk(USAGE),
    ]
  }

  it.each([
    ["structured_output on index 0, another tool on index 1", { structured: 0, other: 1 }],
    ["another tool on index 0, structured_output on index 1", { structured: 1, other: 0 }],
  ])("reads only the structured_output call's fragments when %s", async (_label, order) => {
    createMock.mockResolvedValue(fromChunks(interleaved(order)))
    const stream = start()
    const parts = await drain(stream)

    const deltas = parts.filter((p) => p.type === "text-delta").map((p) => p.textDelta)
    expect(deltas).toEqual(['{"headline":"Bu', 'ild strength",', '"bullets":["a","b","c"]}'])
    for (const part of parts.filter((p) => p.type === "object")) {
      expect(part.object).not.toHaveProperty("brand")
    }
    await expect(stream.object).resolves.toEqual({ headline: "Build strength", bullets: ["a", "b", "c"] })
  })

  it("reports usage on the finish part WITHOUT adding cached tokens to the input count", async () => {
    // prompt_tokens ALREADY INCLUDES the cached reads and writes. Adding them
    // would log 2700 input tokens for a 1500-token prompt — every cached
    // builder turn double-counted in the spend ledger.
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    const parts = await drain(start())
    const finish = parts.find((p) => p.type === "finish") as unknown as {
      finishReason: string
      usage: {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        inputTokenDetails: { cacheReadTokens: number; cacheWriteTokens: number }
        outputTokenDetails: { reasoningTokens: number }
      }
    }
    expect(finish.finishReason).toBe("tool-calls")
    expect(finish.usage.inputTokens).toBe(1500)
    expect(finish.usage.outputTokens).toBe(300)
    expect(finish.usage.totalTokens).toBe(1800)
    expect(finish.usage.inputTokenDetails.cacheReadTokens).toBe(1000)
    expect(finish.usage.inputTokenDetails.cacheWriteTokens).toBe(200)
    expect(finish.usage.outputTokenDetails.reasoningTokens).toBe(50)
  })
})

describe("streamObjectViaOpenRouter — failures the route recovers from or retries", () => {
  it("rejects a schema violation with NoObjectGeneratedError carrying the raw text and the ZodError", async () => {
    // The literal failure recover-object.ts exists for: the whole answer sent
    // as a JSON STRING inside a one-key wrapper.
    const inner = JSON.stringify({ headline: "Strong at any age", bullets: ["one", "two", "three"] })
    const raw = JSON.stringify({ params: inner })
    createMock.mockResolvedValue(fromChunks(toolCallChunks([raw.slice(0, 20), raw.slice(20)])))
    const stream = start()
    const parts = await drain(stream)

    const error = await stream.object.then(
      () => null,
      (e: unknown) => e,
    )
    expect(NoObjectGeneratedError.isInstance(error)).toBe(true)
    const noObject = error as NoObjectGeneratedError
    expect(noObject.message).toBe("No object generated: response did not match schema.")
    expect(noObject.text).toBe(raw)
    expect(noObject.cause).toBeInstanceOf(z.ZodError)
    expect(noObject.finishReason).toBe("tool-calls")

    // Exactly what `streamOneAttempt` does with it: both recovery sources work.
    expect(recoverObjectFromError(error, schema)).toEqual({
      headline: "Strong at any age",
      bullets: ["one", "two", "three"],
    })
    const lastPartial = parts.filter((p) => p.type === "object").at(-1)?.object
    expect(recoverObjectFromValue(lastPartial, schema)).toEqual({
      headline: "Strong at any age",
      bullets: ["one", "two", "three"],
    })
    // And the retry prompt names the fields, not just "did not match schema".
    expect(describeModelError(error).some((line) => line.startsWith("headline:"))).toBe(true)
  })

  it("rejects when the model answered in prose instead of calling the tool", async () => {
    createMock.mockResolvedValue(
      fromChunks([
        chunk({ role: "assistant", content: "I would rather not " }),
        chunk({ content: "write that page." }),
        chunk({}, "stop"),
        usageChunk(USAGE),
      ]),
    )
    const stream = start()
    const parts = await drain(stream)
    expect(parts.filter((p) => p.type === "object")).toEqual([])

    const error = (await stream.object.catch((e: unknown) => e)) as NoObjectGeneratedError
    expect(NoObjectGeneratedError.isInstance(error)).toBe(true)
    expect(error.message).toContain("structured_output")
    expect(error.text).toBe("I would rather not write that page.")
    expect(error.finishReason).toBe("stop")
  })

  it("rejects a truncated tool call, says it was truncated, and REPORTS finishReason length", async () => {
    // The finish reason is what the route reads to refuse recovery. The last
    // partial of a truncated call is a repaired PREFIX that can still pass the
    // schema, so a truncation reported as anything but "length" is an edit cut
    // off mid-headline and applied as a success.
    createMock.mockResolvedValue(fromChunks(toolCallChunks(['{"headline":"Bu', "ild"], { finish: "length" })))
    const stream = start()
    await drain(stream)
    const error = (await stream.object.catch((e: unknown) => e)) as NoObjectGeneratedError
    expect(NoObjectGeneratedError.isInstance(error)).toBe(true)
    expect(error.message).toMatch(/truncated/)
    expect(error.message).toContain("2000")
    expect(error.text).toBe('{"headline":"Build')
    expect(error.finishReason).toBe("length")
  })

  it("reports finishReason other, not a normal finish, when the stream closed before the provider sent one", async () => {
    // The openai SDK's SSE reader ends QUIETLY when the body closes without
    // `[DONE]`, so a connection dropped cleanly mid-answer looks like a stream
    // that ended. Reporting "stop" here would make half a tool call look like
    // a finished one.
    const chunks = toolCallChunks(['{"headline":"Bu', "ild"]).slice(0, 3)
    createMock.mockResolvedValue(fromChunks(chunks))
    const stream = start()
    const parts = await drain(stream)
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: "other" })
    const error = (await stream.object.catch((e: unknown) => e)) as NoObjectGeneratedError
    expect(NoObjectGeneratedError.isInstance(error)).toBe(true)
    expect(error.finishReason).toBe("other")
  })

  it("turns a request that fails outright into an error PART, and rejects .object with the same error", async () => {
    // AI SDK streamObject's behaviour, which the route relies on: iterating
    // does not throw, and "type: error needs no branch" because the same
    // failure comes back out of `await objectPromise`.
    const failure = statusError(503, "503 Service Unavailable")
    createMock.mockRejectedValue(failure)
    const stream = start()
    const parts = await drain(stream)
    expect(parts).toEqual([{ type: "error", error: failure }])
    await expect(stream.object).rejects.toBe(failure)
  })

  it("turns a mid-stream failure into an error part after the parts already sent", async () => {
    const failure = statusError(502, "upstream went away")
    createMock.mockResolvedValue(fromChunks(toolCallChunks(['{"headline":"Bu', "ild"]).slice(0, 3), failure))
    const stream = start()
    const parts = await drain(stream)
    expect(parts.map((p) => p.type)).toEqual(["text-delta", "object", "text-delta", "object", "error"])
    expect(parts.at(-1)).toEqual({ type: "error", error: failure })
    await expect(stream.object).rejects.toBe(failure)
  })

  // THE REAL SHAPE OF A MID-STREAM FAULT. The openai SDK checks every SSE
  // payload for `error` itself and throws `new APIError(undefined, data.error)`
  // (node_modules/openai/core/streaming.js): `.status` undefined, OpenRouter's
  // number only in `.code`, and `.name` plain "Error" — the SDK never sets one.
  // A test that faked `{status: 502}` (above) or `name: "APIConnectionError"`
  // proves nothing about this path, which is why the whole-branch review found
  // the builder treating a 502 as a status-less bug of our own.
  function sseError(code: number, message: string) {
    return new OpenAI.APIError(undefined, { code, message }, undefined, undefined)
  }

  it("lifts a mid-stream SDK APIError's numeric code onto .status, keeping the original as .cause", async () => {
    const raw = sseError(502, "Provider returned error")
    expect(raw.status).toBeUndefined() // the premise: the SDK leaves it off
    createMock.mockResolvedValue(fromChunks(toolCallChunks(['{"headline":"Bu', "ild"]).slice(0, 3), raw))
    const stream = start()
    const parts = await drain(stream)

    const errorPart = parts.at(-1) as { type: string; error: Error & { status?: number } }
    expect(errorPart.type).toBe("error")
    expect(errorPart.error.status).toBe(502)
    expect(errorPart.error.cause).toBe(raw)
    expect(errorPart.error.message).toContain("Provider returned error")
    expect(shouldFallBackToAnthropic(errorPart.error)).toBe(true)

    // The SAME error rejects `.object`, and it is a transport fault, never a
    // NoObjectGeneratedError — the route recovers only from the latter.
    const rejection = await stream.object.catch((e: unknown) => e)
    expect(rejection).toBe(errorPart.error)
    expect(NoObjectGeneratedError.isInstance(rejection)).toBe(false)
  })

  it("lets streamWithAnthropicFallback switch on an SSE 502 that arrives before any part", async () => {
    // The moment the lift is FOR: OpenRouter answers 200, then its first SSE
    // payload is an error. Unlifted, `shouldFallBackToAnthropic` saw a
    // status-less error, called it our own bug, and never switched.
    createMock.mockResolvedValue(fromChunks([], sseError(502, "Provider returned error")))
    const fallback = vi.fn(() => ({
      fullStream: (async function* () {
        yield { type: "finish" as const, finishReason: "stop" as const, usage: {} as never, response: {} as never }
      })(),
      object: Promise.resolve({ headline: "From Anthropic", bullets: ["a", "b", "c"] }),
    }))
    const stream = streamWithAnthropicFallback({ modelId: "claude-opus-5", primary: start(), fallback })
    await drain(stream)
    expect(fallback).toHaveBeenCalledTimes(1)
    await expect(stream.object).resolves.toEqual({ headline: "From Anthropic", bullets: ["a", "b", "c"] })
  })

  it("passes a mid-stream error that already carries a status through untouched", async () => {
    // liftStreamStatus returns an error with a numeric status as-is, so the
    // error part and the rejection are the provider's own object.
    const failure = new OpenAI.InternalServerError(503, { message: "overloaded" }, undefined, new Headers())
    createMock.mockResolvedValue(fromChunks(toolCallChunks(['{"headline":"Bu']).slice(0, 2), failure))
    const stream = start()
    const parts = await drain(stream)
    expect(parts.at(-1)).toEqual({ type: "error", error: failure })
    await expect(stream.object).rejects.toBe(failure)
  })

  it("rejects an unmapped model id as our own bug, through the same error part", async () => {
    const stream = start({ modelId: "claude-made-up-9" })
    const parts = await drain(stream)
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe("error")
    await expect(stream.object).rejects.toThrow(/No OpenRouter slug/)
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe("streamObjectViaOpenRouter — the request", () => {
  function lastBody() {
    return createMock.mock.calls[0][0] as Record<string, unknown> & {
      messages: { role: string; content: unknown }[]
      tools: { type: string; function: { name: string; parameters: { properties: Record<string, unknown> } } }[]
    }
  }

  it("forces the structured_output tool, streams with usage, and sends no sampling knobs", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    await drain(start())
    const body = lastBody()
    expect(body.model).toBe("anthropic/claude-opus-5")
    expect(body.max_tokens).toBe(2000)
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "structured_output" } })
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].function.name).toBe("structured_output")
    expect(Object.keys(body.tools[0].function.parameters.properties).sort()).toEqual(["bullets", "headline"])
    // Opus 5 rejects temperature/top_p, and a `reasoning` key would change how
    // it thinks — neither was ever sent on the Anthropic path.
    expect(body).not.toHaveProperty("temperature")
    expect(body).not.toHaveProperty("top_p")
    expect(body).not.toHaveProperty("reasoning")
  })

  it("puts a cache breakpoint on the system prompt only when asked", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    await drain(start({ cacheSystemPrompt: true }))
    expect(lastBody().messages[0]).toEqual({
      role: "system",
      content: [{ type: "text", text: "You write landing pages.", cache_control: { type: "ephemeral" } }],
    })

    createMock.mockClear()
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    await drain(start())
    expect(lastBody().messages[0]).toEqual({ role: "system", content: "You write landing pages." })
  })

  it("sends a reference image as an image_url part in the user turn", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    await drain(start({ images: [{ mediaType: "image/png", data: "QUJD" }] }))
    expect(lastBody().messages[1]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
        { type: "text", text: "A strength coach's page." },
      ],
    })
  })

  it("sends the user turn as a plain string when there is no image", async () => {
    createMock.mockResolvedValue(fromChunks(toolCallChunks(FRAGMENTS)))
    await drain(start({ images: [] }))
    expect(lastBody().messages[1]).toEqual({ role: "user", content: "A strength coach's page." })
  })
})
