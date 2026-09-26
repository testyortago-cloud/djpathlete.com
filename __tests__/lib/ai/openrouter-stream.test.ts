// The OpenRouter streaming generators must emit EXACTLY the event shapes of
// streamRaw / streamWithTools in functions/src/ai/anthropic.ts, because the
// fallback wrapper swaps one for the other behind the same consumer. These
// tests drive the generators with a fake client whose `create` records what it
// was sent and answers with a scripted list of OpenAI-shaped stream chunks.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { APIError } from "openai"

const createMock = vi.fn()

vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openrouter")>()
  return {
    ...actual,
    getOpenRouterClient: () => ({ chat: { completions: { create: createMock } } }),
  }
})

import {
  streamTextViaOpenRouter,
  streamWithToolsViaOpenRouter,
  foldStreamChunk,
  newStreamRound,
  type StreamSystemBlock,
} from "@/lib/ai/openrouter-stream"
import { shouldFallBackToAnthropic } from "@/lib/ai/openrouter"

// ─── chunk builders ─────────────────────────────────────────────────────────

const textChunk = (content: string) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })

const toolChunk = (index: number, f: { id?: string; name?: string; args?: string }) => ({
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index,
            ...(f.id ? { id: f.id, type: "function" } : {}),
            function: {
              ...(f.name ? { name: f.name } : {}),
              ...(f.args !== undefined ? { arguments: f.args } : {}),
            },
          },
        ],
      },
      finish_reason: null,
    },
  ],
})

const finishChunk = (reason: string) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })

// OpenRouter (like OpenAI) sends usage on a LAST chunk whose choices are empty.
const usageChunk = (prompt: number, completion: number) => ({
  choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion },
})

function streamOf(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

/** Queue one scripted stream per `create` call, in order. */
function respondWith(...rounds: unknown[][]) {
  for (const r of rounds) createMock.mockResolvedValueOnce(streamOf(r))
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const e of gen) out.push(e)
  return out
}

/** Iterate to the end, keeping both what arrived and what it failed with. */
async function collectUntilError<T>(gen: AsyncGenerator<T>): Promise<{ events: T[]; error: unknown }> {
  const events: T[] = []
  try {
    for await (const e of gen) events.push(e)
  } catch (error) {
    return { events, error }
  }
  return { events, error: undefined }
}

function requestAt(call: number): Record<string, unknown> {
  return createMock.mock.calls[call][0] as Record<string, unknown>
}

// ─── fixtures ───────────────────────────────────────────────────────────────

const SYSTEM: StreamSystemBlock[] = [
  { type: "text", text: "You are the coach's assistant.", cache_control: { type: "ephemeral" } },
  { type: "text", text: "Today is Friday." },
]

const TOOLS = [
  { name: "get_client_count", description: "Count clients", input_schema: { type: "object", properties: {} } },
  {
    name: "search_clients",
    description: "Search clients by name",
    input_schema: { type: "object", properties: { q: { type: "string" } } },
  },
]

const USER = [{ role: "user" as const, content: "Find Jane." }]

function toolOpts(overrides: Partial<Parameters<typeof streamWithToolsViaOpenRouter>[0]> = {}) {
  return {
    model: "claude-sonnet-4-6",
    system: SYSTEM,
    messages: USER,
    tools: TOOLS,
    executeTool: vi.fn(async () => "ok"),
    toolLabels: { search_clients: "Searching clients" },
    maxTokens: 2048,
    maxToolRounds: 5,
    ...overrides,
  }
}

beforeEach(() => {
  createMock.mockReset()
})

// ─── streamTextViaOpenRouter ────────────────────────────────────────────────

describe("streamTextViaOpenRouter", () => {
  it("yields text deltas as they arrive, then ONE usage event", async () => {
    respondWith([textChunk("Hel"), textChunk("lo"), finishChunk("stop"), usageChunk(12, 3)])

    const events = await collect(
      streamTextViaOpenRouter({
        model: "claude-haiku-4-5-20251001",
        system: "Be brief.",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 64,
      }),
    )

    expect(events).toEqual([
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "usage", input_tokens: 12, output_tokens: 3 },
    ])
  })

  it("sends the OpenRouter slug, stream:true and stream_options.include_usage, and passes the signal through", async () => {
    // Without include_usage OpenRouter never sends the usage chunk, and every
    // streamed call would be logged as costing zero tokens.
    respondWith([textChunk("ok"), usageChunk(1, 1)])
    const controller = new AbortController()

    await collect(
      streamTextViaOpenRouter({
        model: "claude-haiku-4-5-20251001",
        system: "Be brief.",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 64,
        signal: controller.signal,
      }),
    )

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(requestAt(0)).toEqual({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 64,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hi" },
      ],
    })
    expect(createMock.mock.calls[0][1]).toEqual({ signal: controller.signal })
  })

  it("reads usage from the final chunk whose choices array is EMPTY", async () => {
    // Reading choices[0] unguarded on that chunk throws; skipping chunks with
    // no choices loses the usage. Both have to be right at once.
    respondWith([textChunk("a"), { choices: [], usage: { prompt_tokens: 40, completion_tokens: 7 } }])

    const events = await collect(
      streamTextViaOpenRouter({ model: "claude-haiku-4-5-20251001", system: "s", messages: USER, maxTokens: 10 }),
    )

    expect(events.at(-1)).toEqual({ type: "usage", input_tokens: 40, output_tokens: 7 })
  })

  it("ALSO reads usage when it rides on a chunk that still carries a choice — the shape measured live", async () => {
    // A raw dump of a real Haiku round through OpenRouter (2026-09-26) had
    // usage on the chunk carrying finish_reason, NOT on an empty-choices chunk.
    // Reading usage only from empty-choices chunks passed every other test here
    // and would have reported 0 input and 0 output tokens on every real call.
    respondWith([textChunk("a"), { ...finishChunk("stop"), usage: { prompt_tokens: 9, completion_tokens: 8 } }])

    const events = await collect(
      streamTextViaOpenRouter({ model: "claude-haiku-4-5-20251001", system: "s", messages: USER, maxTokens: 10 }),
    )

    expect(events.at(-1)).toEqual({ type: "usage", input_tokens: 9, output_tokens: 8 })
  })

  it("keeps cache_control on each system part when the system is given as blocks", async () => {
    respondWith([textChunk("ok"), usageChunk(1, 1)])

    await collect(
      streamTextViaOpenRouter({ model: "claude-haiku-4-5-20251001", system: SYSTEM, messages: USER, maxTokens: 10 }),
    )

    expect((requestAt(0).messages as unknown[])[0]).toEqual({
      role: "system",
      content: [
        { type: "text", text: "You are the coach's assistant.", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Today is Friday." },
      ],
    })
  })
})

// ─── streamWithToolsViaOpenRouter ───────────────────────────────────────────

describe("streamWithToolsViaOpenRouter", () => {
  it("streams a text-only answer and stops after one round", async () => {
    respondWith([textChunk("No tools "), textChunk("needed."), finishChunk("stop"), usageChunk(30, 4)])
    const opts = toolOpts()

    const events = await collect(streamWithToolsViaOpenRouter(opts))

    expect(events).toEqual([
      { type: "text", text: "No tools " },
      { type: "text", text: "needed." },
      { type: "usage", input_tokens: 30, output_tokens: 4 },
    ])
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(opts.executeTool).not.toHaveBeenCalled()
  })

  it("sends tools OpenAI-shaped, the system with cache_control intact, and include_usage", async () => {
    respondWith([textChunk("ok"), finishChunk("stop"), usageChunk(1, 1)])

    await collect(streamWithToolsViaOpenRouter(toolOpts()))

    const req = requestAt(0)
    expect(req.model).toBe("anthropic/claude-sonnet-4.6")
    expect(req.max_tokens).toBe(2048)
    expect(req.stream).toBe(true)
    expect(req.stream_options).toEqual({ include_usage: true })
    expect(req.tools).toEqual([
      {
        type: "function",
        function: { name: "get_client_count", description: "Count clients", parameters: TOOLS[0].input_schema },
      },
      {
        type: "function",
        function: { name: "search_clients", description: "Search clients by name", parameters: TOOLS[1].input_schema },
      },
    ])
    expect(req.messages).toEqual([
      {
        role: "system",
        content: [
          { type: "text", text: "You are the coach's assistant.", cache_control: { type: "ephemeral" } },
          { type: "text", text: "Today is Friday." },
        ],
      },
      { role: "user", content: "Find Jane." },
    ])
  })

  it("concatenates one tool call's arguments across three chunks, runs it, and continues", async () => {
    respondWith(
      [
        toolChunk(0, { id: "call_1", name: "search_clients", args: "" }),
        toolChunk(0, { args: '{"q"' }),
        toolChunk(0, { args: ':"ja' }),
        toolChunk(0, { args: 'ne"}' }),
        finishChunk("tool_calls"),
        usageChunk(100, 20),
      ],
      [textChunk("Found Jane."), finishChunk("stop"), usageChunk(150, 10)],
    )
    const executeTool = vi.fn(async () => '[{"name":"Jane"}]')

    const events = await collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool })))

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(executeTool).toHaveBeenCalledWith("search_clients", { q: "jane" })
    expect(events).toEqual([
      { type: "tool_start", name: "search_clients", label: "Searching clients" },
      { type: "tool_result", name: "search_clients" },
      { type: "text", text: "Found Jane." },
      // Summed over both rounds: 100 + 150 in, 20 + 10 out.
      { type: "usage", input_tokens: 250, output_tokens: 30 },
    ])
  })

  it("keeps two INTERLEAVED tool calls apart by index and sends round 2 exactly the right history", async () => {
    respondWith(
      [
        textChunk("Let me check."),
        toolChunk(0, { id: "call_a", name: "get_client_count", args: "" }),
        toolChunk(1, { id: "call_b", name: "search_clients", args: '{"q":' }),
        toolChunk(0, { args: "{}" }),
        toolChunk(1, { args: '"x"}' }),
        finishChunk("tool_calls"),
        usageChunk(80, 25),
      ],
      [textChunk("You have 42."), finishChunk("stop"), usageChunk(120, 6)],
    )
    // The FIRST call resolves LAST, so result order cannot fall out of timing.
    const executeTool = vi.fn(async (name: string) => {
      if (name === "get_client_count") {
        await new Promise((r) => setTimeout(r, 20))
        return "42"
      }
      return "[Jane]"
    })

    const events = await collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool })))

    expect(executeTool).toHaveBeenCalledWith("get_client_count", {})
    expect(executeTool).toHaveBeenCalledWith("search_clients", { q: "x" })
    expect(events.filter((e) => e.type === "tool_result")).toEqual([
      { type: "tool_result", name: "get_client_count" },
      { type: "tool_result", name: "search_clients" },
    ])

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(requestAt(1).messages).toEqual([
      {
        role: "system",
        content: [
          { type: "text", text: "You are the coach's assistant.", cache_control: { type: "ephemeral" } },
          { type: "text", text: "Today is Friday." },
        ],
      },
      { role: "user", content: "Find Jane." },
      {
        role: "assistant",
        content: "Let me check.",
        tool_calls: [
          { id: "call_a", type: "function", function: { name: "get_client_count", arguments: "{}" } },
          { id: "call_b", type: "function", function: { name: "search_clients", arguments: '{"q":"x"}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_a", content: "42" },
      { role: "tool", tool_call_id: "call_b", content: "[Jane]" },
    ])
    // Round 1 was sent the conversation as it stood THEN, not the grown one.
    expect(requestAt(0).messages).toHaveLength(2)
  })

  it("sends assistant content null when the round produced no text before its tool calls", async () => {
    respondWith(
      [toolChunk(0, { id: "call_n", name: "get_client_count", args: "{}" }), finishChunk("tool_calls"), usageChunk(5, 5)],
      [textChunk("42."), finishChunk("stop"), usageChunk(5, 5)],
    )

    await collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool: vi.fn(async () => "42") })))

    const history = requestAt(1).messages as Array<Record<string, unknown>>
    expect(history[2]).toMatchObject({ role: "assistant", content: null })
  })

  it("fires tool_start ONCE per call, when its name first appears, with the label from toolLabels", async () => {
    respondWith(
      [
        toolChunk(0, { id: "call_a", name: "search_clients", args: '{"q":' }),
        // Some upstream providers repeat the name on later deltas. That is the
        // same call, not a second one.
        toolChunk(0, { name: "search_clients", args: '"x"}' }),
        toolChunk(1, { id: "call_b", name: "get_client_count", args: "{}" }),
        finishChunk("tool_calls"),
        usageChunk(5, 5),
      ],
      [textChunk("done"), finishChunk("stop"), usageChunk(5, 5)],
    )

    const events = await collect(streamWithToolsViaOpenRouter(toolOpts()))

    expect(events.filter((e) => e.type === "tool_start")).toEqual([
      { type: "tool_start", name: "search_clients", label: "Searching clients" },
      { type: "tool_start", name: "get_client_count", label: undefined },
    ])
    // tool_start comes as the name streams in — BEFORE the tool has run.
    expect(events.map((e) => e.type)).toEqual([
      "tool_start",
      "tool_start",
      "tool_result",
      "tool_result",
      "text",
      "usage",
    ])
  })

  it("synthesizes a stable id for a tool call that arrived without one, and uses it on both sides", async () => {
    respondWith(
      [toolChunk(0, { name: "get_client_count", args: "{}" }), finishChunk("tool_calls"), usageChunk(5, 5)],
      [textChunk("42."), finishChunk("stop"), usageChunk(5, 5)],
    )

    await collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool: vi.fn(async () => "42") })))

    const history = requestAt(1).messages as Array<Record<string, unknown>>
    const callId = (history[2].tool_calls as Array<{ id: string }>)[0].id
    expect(callId).toMatch(/\S/)
    expect(history[3]).toEqual({ role: "tool", tool_call_id: callId, content: "42" })
  })

  it("stops after maxToolRounds even when the model keeps calling tools", async () => {
    const round = (id: string) => [
      toolChunk(0, { id, name: "get_client_count", args: "{}" }),
      finishChunk("tool_calls"),
      usageChunk(10, 2),
    ]
    respondWith(round("c1"), round("c2"), round("c3"))
    const executeTool = vi.fn(async () => "42")

    const events = await collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool, maxToolRounds: 2 })))

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenCalledTimes(2)
    // Mirrors streamWithTools: the last allowed round's tools still run and
    // report, so a consumer showing a spinner per tool_start gets it cleared.
    expect(events).toEqual([
      { type: "tool_start", name: "get_client_count", label: undefined },
      { type: "tool_result", name: "get_client_count" },
      { type: "tool_start", name: "get_client_count", label: undefined },
      { type: "tool_result", name: "get_client_count" },
      { type: "usage", input_tokens: 20, output_tokens: 4 },
    ])
  })

  it("throws naming the tool and the model when the arguments will not parse, and runs nothing", async () => {
    respondWith([
      toolChunk(0, { id: "call_x", name: "search_clients", args: '{"q":' }),
      finishChunk("tool_calls"),
      usageChunk(5, 5),
    ])
    const executeTool = vi.fn(async () => "never")

    await expect(collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool })))).rejects.toThrow(
      'Tool call "search_clients" returned unparseable arguments (model: claude-sonnet-4-6)',
    )
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("stops quietly, running nothing, when max_tokens cut a tool call off mid-arguments", async () => {
    // Mirrors streamWithTools, which breaks on any stop_reason but "tool_use":
    // a call truncated by the token budget is not the model's malformed output,
    // so it must not surface as "returned unparseable arguments".
    respondWith([
      textChunk("Let me look."),
      toolChunk(0, { id: "call_x", name: "search_clients", args: '{"q":"Jan' }),
      finishChunk("length"),
      usageChunk(5, 5),
    ])
    const executeTool = vi.fn(async () => "never")

    const events = await collect(streamWithToolsViaOpenRouter(toolOpts({ executeTool })))

    expect(executeTool).not.toHaveBeenCalled()
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      { type: "text", text: "Let me look." },
      { type: "tool_start", name: "search_clients", label: "Searching clients" },
      { type: "usage", input_tokens: 5, output_tokens: 5 },
    ])
  })
})

// ─── failures ───────────────────────────────────────────────────────────────

describe("mid-stream failures", () => {
  it("throws on an OpenRouter error chunk, carrying its message and its numeric code as .status", async () => {
    // OpenRouter has already answered 200 by the time this arrives, so the
    // real status only exists inside the chunk.
    respondWith([
      textChunk("Partial"),
      {
        error: { code: 502, message: "Provider returned error" },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      },
    ])

    const { events, error } = await collectUntilError(streamWithToolsViaOpenRouter(toolOpts()))

    expect(events).toEqual([{ type: "text", text: "Partial" }])
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("Provider returned error")
    expect((error as { status?: number }).status).toBe(502)
  })

  it("throws on finish_reason 'error' even when no error object came with it", async () => {
    respondWith([textChunk("Par"), finishChunk("error")])

    const { error } = await collectUntilError(
      streamTextViaOpenRouter({ model: "claude-haiku-4-5-20251001", system: "s", messages: USER, maxTokens: 10 }),
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/error/i)
  })

  it("lifts the SDK's own mid-stream APIError code onto .status, so a 502 is classified as a provider fault", async () => {
    // The openai SDK checks every SSE payload for `error` itself and throws
    // `new APIError(undefined, data.error)` — status UNDEFINED, OpenRouter's
    // number only in `.code`. Left like that, shouldFallBackToAnthropic reads a
    // mid-stream 502 as a status-less bug and refuses to fall back.
    const sdkError = new APIError(undefined, { code: 502, message: "Upstream overloaded" }, undefined, undefined)
    expect(sdkError.status).toBeUndefined()
    createMock.mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        throw sdkError
      },
    })

    const { error } = await collectUntilError(
      streamTextViaOpenRouter({ model: "claude-haiku-4-5-20251001", system: "s", messages: USER, maxTokens: 10 }),
    )

    expect((error as Error).message).toContain("Upstream overloaded")
    expect((error as { status?: number }).status).toBe(502)
    expect(shouldFallBackToAnthropic(error)).toBe(true)
  })

  it("throws an AbortError when the caller aborted, instead of ending as if the answer were complete", async () => {
    // The SDK's stream iterator RETURNS quietly on abort. Without a check the
    // round would end with half a sentence and a usage event, and a caller
    // would store it as the finished reply.
    const controller = new AbortController()
    createMock.mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        yield textChunk("Half a sen")
        controller.abort()
        // Measured live: chunks already buffered keep arriving after the
        // signal fires (three more of them on Haiku). None may be emitted.
        yield textChunk("tence.")
      },
    })

    const { events, error } = await collectUntilError(
      streamTextViaOpenRouter({
        model: "claude-haiku-4-5-20251001",
        system: "s",
        messages: USER,
        maxTokens: 10,
        signal: controller.signal,
      }),
    )

    expect(events).toEqual([{ type: "text", text: "Half a sen" }])
    expect((error as Error).name).toBe("AbortError")
    expect(shouldFallBackToAnthropic(error)).toBe(false)
  })
})

// ─── the fold helper directly ───────────────────────────────────────────────

describe("foldStreamChunk", () => {
  it("accumulates text, per-index tool calls and usage, returning only the events to emit", () => {
    const state = newStreamRound("claude-sonnet-4-6", 0)

    expect(foldStreamChunk(state, textChunk("Hi"))).toEqual([{ type: "text", text: "Hi" }])
    expect(foldStreamChunk(state, toolChunk(1, { id: "b", name: "search_clients", args: '{"q"' }))).toEqual([
      { type: "tool_start", name: "search_clients" },
    ])
    expect(foldStreamChunk(state, toolChunk(0, { id: "a", name: "get_client_count", args: "" }))).toEqual([
      { type: "tool_start", name: "get_client_count" },
    ])
    expect(foldStreamChunk(state, toolChunk(1, { args: ':"z"}' }))).toEqual([])
    expect(foldStreamChunk(state, usageChunk(9, 8))).toEqual([])

    expect(state.text).toBe("Hi")
    expect(state.calls.get(0)).toEqual({ id: "a", name: "get_client_count", arguments: "" })
    expect(state.calls.get(1)).toEqual({ id: "b", name: "search_clients", arguments: '{"q":"z"}' })
    expect(state.usage).toEqual({ prompt_tokens: 9, completion_tokens: 8 })
  })
})
