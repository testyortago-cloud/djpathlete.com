// @vitest-environment node
//
// createMessageCompat is the shim every one-shot model call goes through
// (hook suggestions, quote extraction, the lead-engine tool loop, the image
// judges, and since 2026-09-26 the AI Program Builder chat). Its fallback
// decides which provider's error the owner reads, so these tests pin WHICH
// provider was called and WHICH error came out, not just that something did.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import OpenAI, { APIError } from "openai"

const h = vi.hoisted(() => ({
  orCreate: vi.fn(),
  // The Anthropic SDK's non-streaming `create` must never be used: it refuses
  // max_tokens budgets like program chat's 32000 before sending anything.
  anthropicCreate: vi.fn(async () => {
    throw new Error("messages.create must not be called — use messages.stream().finalMessage()")
  }),
  anthropicStream: vi.fn(),
  anthropicFinal: vi.fn(),
}))

vi.mock("@/lib/ai/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openrouter")>()
  return {
    ...actual,
    getOpenRouterClient: () => ({ chat: { completions: { create: h.orCreate } } }),
  }
})

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: h.anthropicCreate,
      stream: (body: unknown, options?: unknown) => {
        h.anthropicStream(body, options)
        return { finalMessage: () => h.anthropicFinal(body) }
      },
    }
  },
}))

import { createMessageCompat, toOpenAIMessages } from "@/lib/ai/openrouter-message"
import { ProviderFallbackError, shouldFallBackToAnthropic } from "@/lib/ai/openrouter"

/**
 * The SDK module is stubbed above, so its real error class comes from the
 * actual package. Both SDKs' abort classes leave `.name` as "Error"; a fake
 * named "APIUserAbortError" is not what production throws.
 */
async function realAnthropicAbort() {
  const { APIUserAbortError } = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk")
  return new APIUserAbortError()
}

// ─── fixtures ────────────────────────────────────────────────────────────────

function orError(status: number, message: string) {
  return APIError.generate(status, { error: { message } }, message, new Headers())
}

/** The exact failure the owner saw: the Anthropic account has no credit. */
function anthropicCreditError() {
  return Object.assign(
    new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
    ),
    { status: 400 },
  )
}

function orCompletion(message: Record<string, unknown>, finish = "stop") {
  return {
    choices: [{ index: 0, message: { role: "assistant", content: null, ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  }
}

const anthropicMessage = {
  content: [{ type: "text", text: "from anthropic", citations: null }],
  usage: { input_tokens: 3, output_tokens: 2 },
  stop_reason: "end_turn",
}

const base = {
  model: "claude-sonnet-4-6",
  max_tokens: 32000,
  system: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
}

let savedKey: string | undefined

beforeEach(() => {
  h.orCreate.mockReset()
  h.anthropicCreate.mockClear()
  h.anthropicStream.mockReset()
  h.anthropicFinal.mockReset()
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = "or-test-key"
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.restoreAllMocks()
})

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error("expected the call to throw")
}

// ─── provider routing ────────────────────────────────────────────────────────

describe("createMessageCompat — provider routing", () => {
  it("answers from OpenRouter, Anthropic-shaped, and never touches Anthropic on success", async () => {
    h.orCreate.mockResolvedValueOnce(orCompletion({ content: "hello from openrouter" }))

    const res = await createMessageCompat(base)

    expect(res).toEqual({
      content: [{ type: "text", text: "hello from openrouter" }],
      usage: { input_tokens: 11, output_tokens: 7 },
      stop_reason: "stop",
    })
    const sent = h.orCreate.mock.calls[0][0]
    expect(sent.model).toBe("anthropic/claude-sonnet-4.6")
    expect(sent.max_tokens).toBe(32000)
    expect(sent.messages[0]).toEqual({ role: "system", content: "sys" })
    expect(h.anthropicStream).not.toHaveBeenCalled()
    expect(h.anthropicCreate).not.toHaveBeenCalled()
  })

  it("with no OpenRouter key, calls Anthropic through messages.stream().finalMessage(), never messages.create", async () => {
    // messages.create throws "Streaming is required for operations that may
    // take longer than 10 minutes" for any max_tokens above ~21k, locally,
    // before a request is sent. Program chat sends 32000.
    delete process.env.OPENROUTER_API_KEY
    h.anthropicFinal.mockResolvedValueOnce(anthropicMessage)

    const res = await createMessageCompat(base)

    expect(h.orCreate).not.toHaveBeenCalled()
    expect(h.anthropicCreate).not.toHaveBeenCalled()
    expect(h.anthropicStream).toHaveBeenCalledOnce()
    expect(h.anthropicStream.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-4-6",
      max_tokens: 32000,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(res).toEqual({
      content: [{ type: "text", text: "from anthropic" }],
      usage: { input_tokens: 3, output_tokens: 2 },
      stop_reason: "end_turn",
    })
  })

  it("passes the caller's abort signal to OpenRouter as a request option, never in the body", async () => {
    // Program chat hands its turn deadline in here. Without it a slow provider
    // holds the request open past the 540s hard kill, and the job is left
    // "streaming" with no error recorded.
    const controller = new AbortController()
    h.orCreate.mockResolvedValueOnce(orCompletion({ content: "ok" }))

    await createMessageCompat({ ...base, signal: controller.signal })

    expect(h.orCreate.mock.calls[0][1]).toEqual({ signal: controller.signal })
    expect(h.orCreate.mock.calls[0][0]).not.toHaveProperty("signal")
  })

  it("passes the signal to the Anthropic path as well", async () => {
    delete process.env.OPENROUTER_API_KEY
    const controller = new AbortController()
    h.anthropicFinal.mockResolvedValueOnce(anthropicMessage)

    await createMessageCompat({ ...base, signal: controller.signal })

    expect(h.anthropicStream.mock.calls[0][1]).toEqual({ signal: controller.signal })
    expect(h.anthropicStream.mock.calls[0][0]).not.toHaveProperty("signal")
  })

  it("does not fall back when the caller aborted — the deadline is not a provider fault", async () => {
    const abort = new OpenAI.APIUserAbortError()
    expect(abort.name).toBe("Error")
    h.orCreate.mockRejectedValueOnce(abort)

    expect(await failureOf(createMessageCompat(base))).toBe(abort)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("does not fall back once the caller's signal has aborted, whatever OpenRouter threw", async () => {
    // The signal is the one abort marker no bundler can rename. A 503 that
    // lands as the deadline fires is still a request the caller has given up
    // on: falling back would spend the time the deadline exists to protect.
    const controller = new AbortController()
    controller.abort()
    const primary = orError(503, "Upstream overloaded")
    expect(shouldFallBackToAnthropic(primary)).toBe(true) // it WOULD fall back otherwise
    h.orCreate.mockRejectedValueOnce(primary)

    expect(await failureOf(createMessageCompat({ ...base, signal: controller.signal }))).toBe(primary)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })

  it("rethrows an abort DURING the Anthropic fallback UNWRAPPED, never as ProviderFallbackError", async () => {
    // Wrapped, the abort would carry OpenRouter's 429 — which every retry loop
    // reads as transient — and the caller would start another attempt after
    // its own deadline had already fired.
    const abort = await realAnthropicAbort()
    expect(abort.name).toBe("Error")
    h.orCreate.mockRejectedValueOnce(orError(429, "Rate limit exceeded"))
    h.anthropicFinal.mockRejectedValueOnce(abort)

    const error = await failureOf(createMessageCompat(base))

    expect(error).toBe(abort)
    expect(error).not.toBeInstanceOf(ProviderFallbackError)
  })

  it("rethrows Anthropic's error unwrapped when the signal aborted during the fallback", async () => {
    // The class check alone would miss an abort whose class a bundler renamed;
    // the signal cannot be renamed.
    const controller = new AbortController()
    const cut = new Error("Request was aborted.")
    h.orCreate.mockRejectedValueOnce(orError(429, "Rate limit exceeded"))
    h.anthropicFinal.mockImplementationOnce(async () => {
      controller.abort()
      throw cut
    })

    const error = await failureOf(createMessageCompat({ ...base, signal: controller.signal }))

    expect(error).toBe(cut)
    expect(h.anthropicStream).toHaveBeenCalledOnce()
  })

  it("falls back to Anthropic on an OpenRouter 429 and returns Anthropic's answer", async () => {
    h.orCreate.mockRejectedValueOnce(orError(429, "Rate limit exceeded"))
    h.anthropicFinal.mockResolvedValueOnce(anthropicMessage)

    const res = await createMessageCompat(base)

    expect(h.orCreate).toHaveBeenCalledOnce()
    expect(h.anthropicStream).toHaveBeenCalledOnce()
    expect(res.content).toEqual([{ type: "text", text: "from anthropic" }])
  })

  it("when the Anthropic fallback ALSO fails, throws ProviderFallbackError leading with OpenRouter's fault", async () => {
    // The incident: an OpenRouter hiccup reached the owner as Anthropic's
    // "credit balance is too low", which reads as "never migrated".
    const primary = orError(429, "Rate limit exceeded")
    const fallback = anthropicCreditError()
    h.orCreate.mockRejectedValueOnce(primary)
    h.anthropicFinal.mockRejectedValueOnce(fallback)

    const error = await failureOf(createMessageCompat(base))

    expect(error).toBeInstanceOf(ProviderFallbackError)
    const pfe = error as ProviderFallbackError
    expect(pfe.message.startsWith("OpenRouter failed: ")).toBe(true)
    expect(pfe.message).toContain("Rate limit exceeded")
    expect(pfe.message).toContain("credit balance is too low")
    expect(pfe.message.indexOf("Rate limit exceeded")).toBeLessThan(pfe.message.indexOf("credit balance"))
    // OpenRouter's status, so a retry loop still sees a retryable 429.
    expect(pfe.status).toBe(429)
    expect(pfe.openRouterError).toBe(primary)
    expect(pfe.anthropicError).toBe(fallback)
  })

  it("never falls back for a non-Claude model: gpt-6-astra + OpenRouter 503 rethrows the 503 itself", async () => {
    const primary = orError(503, "Upstream overloaded")
    h.orCreate.mockRejectedValueOnce(primary)

    const error = await failureOf(createMessageCompat({ ...base, model: "gpt-6-astra" }))

    expect(error).toBe(primary)
    expect(h.anthropicStream).not.toHaveBeenCalled()
    expect(h.anthropicCreate).not.toHaveBeenCalled()
  })

  it("does not fall back on an OpenRouter 400 — our own malformed request fails the same on Anthropic", async () => {
    const primary = orError(400, "Invalid tool schema")
    h.orCreate.mockRejectedValueOnce(primary)

    const error = await failureOf(createMessageCompat(base))

    expect(error).toBe(primary)
    expect(h.anthropicStream).not.toHaveBeenCalled()
  })
})

// ─── history conversion ──────────────────────────────────────────────────────

describe("createMessageCompat — tool history", () => {
  it("sends a tool_use / tool_result round trip as assistant tool_calls + role:'tool' messages", async () => {
    h.orCreate.mockResolvedValueOnce(orCompletion({ content: "You have Ana and Ben." }))

    await createMessageCompat({
      ...base,
      tools: [{ name: "list_clients", description: "List clients", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "Which clients do I have?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", id: "toolu_1", name: "list_clients", input: {} },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"clients":["Ana","Ben"]}' }],
        },
      ],
    })

    const sent = h.orCreate.mock.calls[0][0]
    expect(sent.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "Which clients do I have?" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Let me check." }],
        tool_calls: [{ id: "toolu_1", type: "function", function: { name: "list_clients", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "toolu_1", content: '{"clients":["Ana","Ben"]}' },
    ])
    expect(sent.tools).toEqual([
      {
        type: "function",
        function: { name: "list_clients", description: "List clients", parameters: { type: "object", properties: {} } },
      },
    ])
  })

  it("converts history persisted by the OLD Anthropic-SDK program chat (extra SDK fields such as citations:null)", () => {
    // Program chat persists its API history to Firestore (ai_chat_state) and
    // reloads it next turn. Sessions saved before the OpenRouter move hold raw
    // Anthropic SDK blocks, which carry fields the compat types never name.
    const stored = [
      { role: "user", content: "Build Ana a program" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Looking her up.", citations: null },
          {
            type: "tool_use",
            id: "toolu_9",
            name: "lookup_client_profile",
            input: { client_id: "c1", client_name: "Ana" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_9", content: '{"client_id":"c1","goals":["speed"]}' }],
      },
      { role: "assistant", content: [{ type: "text", text: "She wants speed.", citations: null }] },
      { role: "user", content: "Go ahead" },
    ] as unknown as Parameters<typeof toOpenAIMessages>[0]

    expect(toOpenAIMessages(stored)).toEqual([
      { role: "user", content: "Build Ana a program" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Looking her up." }],
        tool_calls: [
          {
            id: "toolu_9",
            type: "function",
            function: { name: "lookup_client_profile", arguments: '{"client_id":"c1","client_name":"Ana"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "toolu_9", content: '{"client_id":"c1","goals":["speed"]}' },
      { role: "assistant", content: [{ type: "text", text: "She wants speed." }] },
      { role: "user", content: "Go ahead" },
    ])
  })
})
