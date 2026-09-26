import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"

/**
 * streamRaw and streamWithTools are what the admin "DJP Assistant" chat
 * (admin-chat.ts) and the exercise coach (ai-coach.ts) stream through. The
 * first OpenRouter migration moved only the one-shot calls, so these kept
 * calling Anthropic directly — and with the Anthropic account unfunded the
 * owner saw "Your credit balance is too low" in the admin chat.
 *
 * What is pinned here: OpenRouter answers first; Anthropic is tried only when
 * OpenRouter failed with a provider fault BEFORE the consumer saw any event
 * (after that, a second provider would repeat text the chat already wrote to
 * Firestore and run the tools a second time); and when both fail, the error
 * the chat shows leads with OpenRouter's fault, not Anthropic's.
 */

const h = vi.hoisted(() => ({
  anthropicCtor: vi.fn(),
  anthropicStream: vi.fn(),
  orText: vi.fn(),
  orTools: vi.fn(),
}))

// Only the CLIENT is faked; the error classes stay the SDK's own, so an abort
// thrown here is the real class whose `.name` is plain "Error" — not a fake
// that names itself and so passes a check no real error would.
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>()
  const Anthropic = Object.assign(
    vi.fn().mockImplementation(() => {
      h.anthropicCtor()
      return { messages: { stream: h.anthropicStream } }
    }),
    {
      APIError: real.APIError,
      APIUserAbortError: real.APIUserAbortError,
      APIConnectionError: real.APIConnectionError,
      APIConnectionTimeoutError: real.APIConnectionTimeoutError,
    },
  )
  return { ...real, default: Anthropic, Anthropic }
})

vi.mock("../openrouter-stream.js", () => ({
  streamTextViaOpenRouter: h.orText,
  streamWithToolsViaOpenRouter: h.orTools,
}))

type AnthropicModule = typeof import("../anthropic.js")
type OpenRouterModule = typeof import("../openrouter.js")

let mod: AnthropicModule
let ProviderFallbackError: OpenRouterModule["ProviderFallbackError"]

const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY

beforeEach(async () => {
  // A fresh module per test: anthropic.ts caches its client in a singleton,
  // and "Anthropic was never constructed" is only provable on a fresh one.
  vi.resetModules()
  h.anthropicCtor.mockReset()
  h.anthropicStream.mockReset()
  h.orText.mockReset()
  h.orTools.mockReset()
  process.env.OPENROUTER_API_KEY = "sk-or-test"
  mod = await import("../anthropic.js")
  ;({ ProviderFallbackError } = await import("../openrouter.js"))
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

/** The exact failure the owner saw: the unfunded Anthropic account's 400. */
const creditError = () =>
  httpError(
    400,
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
  )

const rateLimit = () =>
  httpError(429, "429 Rate limit exceeded: anthropic/claude-sonnet-4.6 is temporarily rate-limited")

/**
 * The shape openrouter-stream's own `callerAbort` throws when the signal fires
 * mid-stream — it DOES name itself. The SDK's classes do not; see
 * `sdkAbort` / `anthropicAbort` below for those.
 */
function abortError(): Error {
  const e = new Error("OpenRouter stream aborted by the caller (model: claude-sonnet-4-6)")
  e.name = "AbortError"
  return e
}

/** What the openai SDK throws when the signal fires before the stream opens. `.name` is "Error". */
function sdkAbort(): Error {
  const e = new OpenAI.APIUserAbortError()
  expect(e.name).toBe("Error")
  return e
}

/** The Anthropic SDK's real abort class. `.name` is "Error" here too. */
function anthropicAbort(): Error {
  const e = new Anthropic.APIUserAbortError()
  expect(e.name).toBe("Error")
  return e
}

async function* events<E>(list: E[], thenThrow?: unknown): AsyncGenerator<E> {
  for (const e of list) yield e
  if (thenThrow !== undefined) throw thenThrow
}

/** A stand-in for Anthropic's MessageStream: raw events to iterate, plus finalMessage(). */
function anthropicTextStream(texts: string[], usage = { input_tokens: 11, output_tokens: 7 }) {
  const raw = [
    { type: "message_start", message: { usage: { input_tokens: usage.input_tokens } } },
    ...texts.map((text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } })),
    { type: "message_delta", usage: { output_tokens: usage.output_tokens } },
  ]
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of raw) yield e
    },
    finalMessage: async () => ({
      stop_reason: "end_turn",
      usage,
      content: [{ type: "text", text: texts.join("") }],
    }),
  }
}

/** An Anthropic stream that fails — optionally after emitting some text first. */
function anthropicFailingStream(error: unknown, before: string[] = []) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of before) yield { type: "content_block_delta", delta: { type: "text_delta", text } }
      throw error
    },
    finalMessage: () => Promise.reject(error),
  }
}

async function collect<E>(gen: AsyncGenerator<E>): Promise<{ seen: E[]; error: unknown }> {
  const seen: E[] = []
  try {
    for await (const e of gen) seen.push(e)
    return { seen, error: undefined }
  } catch (error) {
    return { seen, error }
  }
}

const TOOLS = [
  {
    name: "get_business_snapshot",
    description: "Revenue, clients and bookings at a glance.",
    input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
]
const SYSTEM = [
  { type: "text" as const, text: "You are the DJP admin assistant.", cache_control: { type: "ephemeral" as const } },
]
const MESSAGES = [{ role: "user" as const, content: "How is the business doing?" }]
const LABELS = { get_business_snapshot: "Checking the numbers" }

function toolOpts(overrides: Record<string, unknown> = {}) {
  return {
    system: SYSTEM,
    messages: MESSAGES,
    tools: TOOLS,
    executeTool: vi.fn(async () => '{"clients":12}'),
    toolLabels: LABELS,
    ...overrides,
  }
}

const ANTHROPIC_EVENTS = [
  { type: "text", text: "Hello" },
  { type: "text", text: " there" },
  { type: "usage", input_tokens: 11, output_tokens: 7 },
]

// ─── streamWithTools ─────────────────────────────────────────────────────────

describe("streamWithTools provider routing", () => {
  it("passes OpenRouter's events through unchanged and never builds or calls Anthropic", async () => {
    const orEvents = [
      { type: "tool_start", name: "get_business_snapshot", label: "Checking the numbers" },
      { type: "tool_result", name: "get_business_snapshot" },
      { type: "text", text: "12 active clients." },
      { type: "usage", input_tokens: 100, output_tokens: 20 },
    ]
    h.orTools.mockImplementation(() => events(orEvents))
    const opts = toolOpts()

    const { seen, error } = await collect(mod.streamWithTools(opts))

    expect(error).toBeUndefined()
    expect(seen).toEqual(orEvents)
    expect(h.anthropicStream).not.toHaveBeenCalled()
    expect(h.anthropicCtor).not.toHaveBeenCalled()
    expect(h.orTools).toHaveBeenCalledTimes(1)
    const args = h.orTools.mock.calls[0][0]
    // The defaults the Anthropic implementation always had.
    expect(args).toMatchObject({
      model: "claude-sonnet-4-6",
      maxTokens: 16384,
      maxToolRounds: 5,
      system: SYSTEM,
      messages: MESSAGES,
      toolLabels: LABELS,
    })
    expect(args.tools).toEqual([
      { name: "get_business_snapshot", description: TOOLS[0].description, input_schema: TOOLS[0].input_schema },
    ])
    expect(args.executeTool).toBe(opts.executeTool)
  })

  it("forwards an explicit model, maxTokens and maxToolRounds", async () => {
    h.orTools.mockImplementation(() => events([{ type: "usage", input_tokens: 1, output_tokens: 1 }]))

    await collect(
      mod.streamWithTools(toolOpts({ model: "claude-haiku-4-5-20251001", maxTokens: 32000, maxToolRounds: 3 })),
    )

    expect(h.orTools.mock.calls[0][0]).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 32000,
      maxToolRounds: 3,
    })
  })

  it("uses the Anthropic implementation, untouched, when OpenRouter is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY
    h.anthropicStream.mockImplementation(() => anthropicTextStream(["Hello", " there"]))

    const { seen, error } = await collect(mod.streamWithTools(toolOpts()))

    expect(error).toBeUndefined()
    expect(seen).toEqual(ANTHROPIC_EVENTS)
    expect(h.orTools).not.toHaveBeenCalled()
    expect(h.anthropicStream.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      tools: TOOLS,
    })
  })

  it("falls back to Anthropic when OpenRouter 429s before emitting anything", async () => {
    h.orTools.mockImplementation(() => events([], rateLimit()))
    h.anthropicStream.mockImplementation(() => anthropicTextStream(["Hello", " there"]))

    const { seen, error } = await collect(mod.streamWithTools(toolOpts()))

    expect(error).toBeUndefined()
    expect(seen).toEqual(ANTHROPIC_EVENTS)
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
    // Presence control for the "never built" assertions above: the constructor
    // spy does see a client being built when the fallback really runs.
    expect(h.anthropicCtor).toHaveBeenCalledTimes(1)
  })

  it("throws a ProviderFallbackError that LEADS with OpenRouter when the unfunded fallback also fails", async () => {
    const orErr = rateLimit()
    const anErr = creditError()
    h.orTools.mockImplementation(() => events([], orErr))
    h.anthropicStream.mockImplementation(() => anthropicFailingStream(anErr))

    const { seen, error } = await collect(mod.streamWithTools(toolOpts()))

    expect(seen).toEqual([])
    expect(error).toBeInstanceOf(ProviderFallbackError)
    const e = error as InstanceType<typeof ProviderFallbackError>
    expect(e.message.startsWith("OpenRouter failed")).toBe(true)
    expect(e.message).toContain("429 Rate limit exceeded")
    expect(e.message).toContain("credit balance is too low")
    expect(e.status).toBe(429)
    expect(e.openRouterError).toBe(orErr)
    expect(e.anthropicError).toBe(anErr)
  })

  it("never falls back once the consumer has an event: rethrows, and the tools do not run again", async () => {
    const midStream = httpError(502, "OpenRouter stream failed mid-response (model: claude-sonnet-4-6): upstream")
    h.orTools.mockImplementation(async function* (o: {
      executeTool: (n: string, i: Record<string, unknown>) => Promise<string>
    }) {
      yield { type: "text", text: "Let me check." }
      yield { type: "tool_start", name: "get_business_snapshot", label: "Checking the numbers" }
      await o.executeTool("get_business_snapshot", {})
      yield { type: "tool_result", name: "get_business_snapshot" }
      throw midStream
    })
    const opts = toolOpts()

    const { seen, error } = await collect(mod.streamWithTools(opts))

    expect(error).toBe(midStream)
    expect(seen).toHaveLength(3)
    expect(opts.executeTool).toHaveBeenCalledTimes(1)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back on an OpenRouter 400 — that is our own malformed request", async () => {
    const badRequest = httpError(400, "400 tools.0.function.parameters: invalid schema")
    h.orTools.mockImplementation(() => events([], badRequest))

    const { error } = await collect(mod.streamWithTools(toolOpts()))

    expect(error).toBe(badRequest)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back on an abort", async () => {
    const aborted = abortError()
    h.orTools.mockImplementation(() => events([], aborted))

    const { error } = await collect(mod.streamWithTools(toolOpts()))

    expect(error).toBe(aborted)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back on the openai SDK's own APIUserAbortError", async () => {
    const aborted = sdkAbort()
    h.orTools.mockImplementation(() => events([], aborted))

    const { error } = await collect(mod.streamWithTools(toolOpts()))

    expect(error).toBe(aborted)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("surfaces an abort DURING the Anthropic fallback as the abort itself, not a ProviderFallbackError", async () => {
    // Wrapped, the abort would read as "OpenRouter failed: 503 …" and carry
    // OpenRouter's 503 — a deadline dressed up as a provider outage.
    const aborted = anthropicAbort()
    h.orTools.mockImplementation(() => events([], httpError(503, "503 Service Unavailable")))
    h.anthropicStream.mockImplementation(() => anthropicFailingStream(aborted))

    const { seen, error } = await collect(mod.streamWithTools(toolOpts()))

    expect(seen).toEqual([])
    expect(error).toBe(aborted)
    expect(error).not.toBeInstanceOf(ProviderFallbackError)
    // Presence control: the fallback really was attempted.
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
  })

  it("does not send a non-Claude model to Anthropic", async () => {
    const outage = httpError(503, "503 Service Unavailable")
    h.orTools.mockImplementation(() => events([], outage))

    const { error } = await collect(mod.streamWithTools(toolOpts({ model: "gpt-6-astra" })))

    expect(error).toBe(outage)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("rethrows the fallback's own error as-is once the fallback has emitted something", async () => {
    const overloaded = httpError(529, "529 overloaded_error")
    h.orTools.mockImplementation(() => events([], httpError(503, "503 Service Unavailable")))
    h.anthropicStream.mockImplementation(() => anthropicFailingStream(overloaded, ["Partial"]))

    const { seen, error } = await collect(mod.streamWithTools(toolOpts()))

    expect(seen).toEqual([{ type: "text", text: "Partial" }])
    expect(error).toBe(overloaded)
  })
})

// ─── streamRaw ───────────────────────────────────────────────────────────────

describe("streamRaw provider routing", () => {
  const rawOpts = () => ({
    system: "You are a strength coach.",
    messages: [
      { role: "user" as const, content: "How heavy should I go?" },
      { role: "assistant" as const, content: "What did you lift last week?" },
      { role: "user" as const, content: "80kg for 5." },
    ],
  })

  it("passes OpenRouter's events through unchanged and never builds or calls Anthropic", async () => {
    const orEvents = [
      { type: "text", text: "Try 82.5kg." },
      { type: "usage", input_tokens: 40, output_tokens: 9 },
    ]
    h.orText.mockImplementation(() => events(orEvents))
    const opts = rawOpts()

    const { seen, error } = await collect(mod.streamRaw(opts))

    expect(error).toBeUndefined()
    expect(seen).toEqual(orEvents)
    expect(h.anthropicStream).not.toHaveBeenCalled()
    expect(h.anthropicCtor).not.toHaveBeenCalled()
    expect(h.orText.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-4-6",
      maxTokens: 16384,
      system: opts.system,
      messages: opts.messages,
    })
  })

  it("uses the Anthropic implementation, untouched, when OpenRouter is not configured", async () => {
    delete process.env.OPENROUTER_API_KEY
    h.anthropicStream.mockImplementation(() => anthropicTextStream(["Hello", " there"]))

    const { seen, error } = await collect(mod.streamRaw({ ...rawOpts(), maxTokens: 32000 }))

    expect(error).toBeUndefined()
    expect(seen).toEqual(ANTHROPIC_EVENTS)
    expect(h.orText).not.toHaveBeenCalled()
    expect(h.anthropicStream.mock.calls[0][0]).toMatchObject({ model: "claude-sonnet-4-6", max_tokens: 32000 })
  })

  it("falls back to Anthropic when OpenRouter 503s before emitting anything", async () => {
    h.orText.mockImplementation(() => events([], httpError(503, "503 Service Unavailable")))
    h.anthropicStream.mockImplementation(() => anthropicTextStream(["Hello", " there"]))

    const { seen, error } = await collect(mod.streamRaw(rawOpts()))

    expect(error).toBeUndefined()
    expect(seen).toEqual(ANTHROPIC_EVENTS)
  })

  it("throws a ProviderFallbackError that LEADS with OpenRouter when the unfunded fallback also fails", async () => {
    const orErr = rateLimit()
    h.orText.mockImplementation(() => events([], orErr))
    h.anthropicStream.mockImplementation(() => anthropicFailingStream(creditError()))

    const { seen, error } = await collect(mod.streamRaw(rawOpts()))

    expect(seen).toEqual([])
    expect(error).toBeInstanceOf(ProviderFallbackError)
    const e = error as Error
    expect(e.message.startsWith("OpenRouter failed")).toBe(true)
    expect(e.message).toContain("429 Rate limit exceeded")
  })

  it("never falls back once text has been emitted", async () => {
    const midStream = httpError(502, "OpenRouter stream failed mid-response (model: claude-sonnet-4-6): upstream")
    h.orText.mockImplementation(() => events([{ type: "text", text: "Try 8" }], midStream))

    const { seen, error } = await collect(mod.streamRaw(rawOpts()))

    expect(seen).toEqual([{ type: "text", text: "Try 8" }])
    expect(error).toBe(midStream)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back on an OpenRouter 400", async () => {
    const badRequest = httpError(400, "400 messages.1.content: must be a string")
    h.orText.mockImplementation(() => events([], badRequest))

    const { error } = await collect(mod.streamRaw(rawOpts()))

    expect(error).toBe(badRequest)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back on an abort", async () => {
    const aborted = abortError()
    h.orText.mockImplementation(() => events([], aborted))

    const { error } = await collect(mod.streamRaw(rawOpts()))

    expect(error).toBe(aborted)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back on the openai SDK's own APIUserAbortError", async () => {
    const aborted = sdkAbort()
    h.orText.mockImplementation(() => events([], aborted))

    const { error } = await collect(mod.streamRaw(rawOpts()))

    expect(error).toBe(aborted)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("surfaces an abort DURING the Anthropic fallback as the abort itself, not a ProviderFallbackError", async () => {
    const aborted = anthropicAbort()
    h.orText.mockImplementation(() => events([], httpError(503, "503 Service Unavailable")))
    h.anthropicStream.mockImplementation(() => anthropicFailingStream(aborted))

    const { seen, error } = await collect(mod.streamRaw(rawOpts()))

    expect(seen).toEqual([])
    expect(error).toBe(aborted)
    expect(error).not.toBeInstanceOf(ProviderFallbackError)
    expect(h.anthropicStream).toHaveBeenCalledTimes(1)
  })
})
