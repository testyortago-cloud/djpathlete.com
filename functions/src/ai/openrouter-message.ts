// GENERATED TWIN of lib/ai/openrouter-message.ts — functions/ has rootDir "src" and cannot import
// from lib/. Regenerate with scripts/gen-openrouter-twins.py rather than
// editing by hand; the two must not drift.
import Anthropic from "@anthropic-ai/sdk"
import {
  canFallBackToAnthropic,
  getOpenRouterClient,
  isOpenRouterConfigured,
  ProviderFallbackError,
  shouldFallBackToAnthropic,
  toOpenRouterModel,
} from "./openrouter.js"

/**
 * A drop-in replacement for `client.messages.create(...)` that goes to
 * OpenRouter, falling back to direct Anthropic on a provider fault.
 *
 * WHY A COMPAT SHIM RATHER THAN REWRITING EACH CALLER: thirteen call sites all
 * did the same three things — build a system prompt plus one user turn, call
 * `messages.create`, then read the first text block. Rewriting each one means
 * thirteen chances to change behaviour by accident in code that currently
 * works. Returning an Anthropic-SHAPED response instead makes every conversion
 * a one-line edit with the downstream handling untouched.
 *
 * It also speaks TOOLS, in both directions, because two scripts use forced tool
 * choice as structured output and one caller (`lib/ai/tool-loop.ts`) is a real
 * agentic loop that feeds `tool_use` blocks back in as `tool_result`.
 *
 * NOT supported: streaming to the caller. Nothing that goes through here
 * streams. (The Anthropic fallback streams INTERNALLY and returns the final
 * message — see `viaAnthropic` for why.)
 *
 * Twin: functions/src/ai/openrouter-message.ts.
 */

/** True when EITHER provider can serve a call. */
export function hasModelProvider(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY)
}

/**
 * Fail fast when neither provider is configured.
 *
 * Replaces the `if (!process.env.ANTHROPIC_API_KEY) throw` guards these callers
 * used to carry. Those guards became WRONG the moment OpenRouter became the
 * primary: an OpenRouter-only deployment is now the expected configuration, and
 * the old check would have rejected it while the provider sat there working.
 */
export function assertModelProvider(): void {
  if (!hasModelProvider()) {
    throw new Error(
      "No model provider configured — set OPENROUTER_API_KEY (preferred) or ANTHROPIC_API_KEY (fallback).",
    )
  }
}

type Base64Source = { type: "base64"; media_type: string; data: string }
type UrlSource = { type: "url"; url: string }

/**
 * Anthropic permits a URL image source as well as base64, and at least one
 * caller (video-vision) types its array as the SDK's full `ContentBlockParam`.
 * Accepting only base64 here type-errors at THAT caller rather than at this
 * file, which sends the next person looking in the wrong place.
 */
export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: Base64Source | UrlSource }
  | { type: "document"; source: Base64Source | UrlSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

/** The content a caller may put in one turn. Exported so callers can annotate. */
export type CompatContent = string | AnthropicBlock[]

export interface CompatTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export interface CompatMessageParams {
  model: string
  max_tokens: number
  system?: string
  temperature?: number
  messages: Array<{ role: "user" | "assistant"; content: CompatContent }>
  tools?: CompatTool[]
  tool_choice?: { type: "tool"; name: string } | { type: "auto" } | { type: "any" }
  /**
   * Aborts the in-flight request on either provider. A request option, never
   * part of the body. Program chat passes its turn deadline here: without it a
   * slow provider holds the request open past the function's hard kill, the
   * catch block never runs, and the job is left "streaming" with no error.
   */
  signal?: AbortSignal
}

export type CompatResponseBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }

/** The subset of an Anthropic Message these callers actually read. */
export interface CompatMessage {
  content: CompatResponseBlock[]
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: string | null
}

type OpenAIPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } }

/** Both Anthropic source shapes collapse to the one URL string OpenAI takes. */
function sourceToUrl(source: Base64Source | UrlSource): string {
  return source.type === "url" ? source.url : `data:${source.media_type};base64,${source.data}`
}

/**
 * One Anthropic turn can become SEVERAL OpenAI messages.
 *
 * Anthropic carries tool results as `tool_result` blocks inside a normal user
 * turn; OpenAI requires each one to be its own `role:"tool"` message keyed by
 * `tool_call_id`. Likewise an assistant turn's `tool_use` blocks move out of
 * `content` into a sibling `tool_calls` array. Flattening these wrongly is not
 * a type error — the request is accepted and the model simply loses track of
 * which result answered which call.
 */
export function toOpenAIMessages(
  messages: Array<{ role: "user" | "assistant"; content: CompatContent }>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content })
      continue
    }

    const toolResults = m.content.filter((b) => b.type === "tool_result")
    const toolUses = m.content.filter((b) => b.type === "tool_use")
    const plain = m.content.filter((b) => b.type !== "tool_result" && b.type !== "tool_use")

    // Tool results lead: OpenAI wants them immediately after the assistant turn
    // that requested them, each as its own message.
    for (const r of toolResults) {
      const tr = r as Extract<AnthropicBlock, { type: "tool_result" }>
      out.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content })
    }

    const parts: OpenAIPart[] = []
    for (const block of plain) {
      if (block.type === "text") parts.push({ type: "text", text: block.text })
      else if (block.type === "image") parts.push({ type: "image_url", image_url: { url: sourceToUrl(block.source) } })
      else if (block.type === "document") {
        parts.push({
          type: "file",
          file: { filename: `document-${parts.length + 1}.pdf`, file_data: sourceToUrl(block.source) },
        })
      }
    }

    if (toolUses.length > 0) {
      out.push({
        role: "assistant",
        content: parts.length > 0 ? parts : null,
        tool_calls: toolUses.map((b) => {
          const tu = b as Extract<AnthropicBlock, { type: "tool_use" }>
          return {
            id: tu.id,
            type: "function",
            function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
          }
        }),
      })
    } else if (parts.length > 0) {
      out.push({ role: m.role, content: parts })
    }
  }

  return out
}

export function toOpenAITools(tools: CompatTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

function toOpenAIToolChoice(choice: CompatMessageParams["tool_choice"]) {
  if (!choice) return undefined
  if (choice.type === "tool") return { type: "function" as const, function: { name: choice.name } }
  if (choice.type === "any") return "required" as const
  return "auto" as const
}

async function viaOpenRouter(params: CompatMessageParams): Promise<CompatMessage> {
  const client = getOpenRouterClient()
  const messages: Array<Record<string, unknown>> = []
  if (params.system) messages.push({ role: "system", content: params.system })
  messages.push(...toOpenAIMessages(params.messages))

  const completion = await client.chat.completions.create(
    {
      model: toOpenRouterModel(params.model),
      max_tokens: params.max_tokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.tools ? { tools: toOpenAITools(params.tools) } : {}),
      ...(params.tool_choice ? { tool_choice: toOpenAIToolChoice(params.tool_choice) } : {}),
      messages: messages as never,
    },
    params.signal ? { signal: params.signal } : undefined,
  )

  const choice = completion.choices?.[0]
  const refusal = (choice?.message as { refusal?: string | null } | undefined)?.refusal
  if (refusal) throw new Error(`Model declined the request (${params.model}): ${refusal}`)

  const content: CompatResponseBlock[] = []
  const text = choice?.message?.content
  if (text) content.push({ type: "text", text })

  const toolCalls = choice?.message?.tool_calls ?? []
  for (const call of toolCalls) {
    const fn = (call as { id: string; function?: { name?: string; arguments?: string } }).function
    if (!fn?.name) continue
    let input: unknown
    try {
      input = JSON.parse(fn.arguments || "{}")
    } catch {
      // A tool call whose arguments will not parse is not usable. Surface it
      // rather than handing the caller an empty object it cannot tell apart
      // from a legitimately argument-free call.
      throw new Error(`Tool call "${fn.name}" returned unparseable arguments (model: ${params.model})`)
    }
    content.push({ type: "tool_use", id: (call as { id: string }).id, name: fn.name, input })
  }

  return {
    content,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
    // Callers branch on `stop_reason !== "tool_use"` to end an agentic loop, so
    // this must say "tool_use" whenever tool calls came back — OpenAI spells the
    // same state "tool_calls".
    stop_reason: toolCalls.length > 0 ? "tool_use" : (choice?.finish_reason ?? null),
  }
}

let _anthropic: Anthropic | null = null
function anthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _anthropic
}

/**
 * Direct Anthropic, via `messages.stream(...).finalMessage()` rather than
 * `messages.create(...)`.
 *
 * WHY STREAM. The SDK refuses a non-streaming request whose max_tokens implies
 * more than ten minutes of generation (anything above roughly 21k tokens):
 * "Streaming is required for operations that may take longer than 10 minutes".
 * It throws locally, before a request is sent. The AI Program Builder chat
 * sends max_tokens 32000, so with `create` its fallback could never be sent at
 * all, and a fallback that can never be sent is not a fallback. `finalMessage()`
 * resolves to the same complete Message `create` returns, so the mapping below
 * is unchanged.
 */
async function viaAnthropic(params: CompatMessageParams): Promise<CompatMessage> {
  const res = await anthropicClient()
    .messages.stream(
      {
        model: params.model,
        max_tokens: params.max_tokens,
        ...(params.system ? { system: params.system } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.tools ? { tools: params.tools } : {}),
        ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
        messages: params.messages,
      } as never,
      params.signal ? { signal: params.signal } : undefined,
    )
    .finalMessage()

  const content: CompatResponseBlock[] = []
  for (const b of res.content) {
    if (b.type === "text") content.push({ type: "text", text: b.text })
    else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input })
  }
  return {
    content,
    usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 },
    stop_reason: res.stop_reason ?? null,
  }
}

/**
 * OpenRouter first; direct Anthropic only for a provider fault on a Claude
 * model.
 *
 * WHY THE FALLBACK'S OWN FAILURE IS WRAPPED. With the Anthropic account
 * unfunded, returning the fallback's error meant every OpenRouter 429 or 5xx
 * reached the owner as "Your credit balance is too low", which reads exactly
 * like "this feature was never moved to OpenRouter". ProviderFallbackError
 * leads with OpenRouter's fault and keeps OpenRouter's `.status`, so a caller's
 * retry loop still sees a retryable 429 rather than Anthropic's final 400.
 *
 * This call is not streamed to its caller, so nothing has been handed over by
 * the time OpenRouter fails, and a fallback can never duplicate output.
 */
export async function createMessageCompat(params: CompatMessageParams): Promise<CompatMessage> {
  if (!isOpenRouterConfigured()) return viaAnthropic(params)
  try {
    return await viaOpenRouter(params)
  } catch (e) {
    // Provider availability only. A 400 is our own malformed request and fails
    // identically on Anthropic, so re-throw rather than pay for it twice. A
    // non-Claude model (gpt-6-astra) does not exist on Anthropic: its 404 would
    // only replace the OpenRouter fault the owner needs to see.
    if (!shouldFallBackToAnthropic(e) || !canFallBackToAnthropic(params.model)) throw e
    console.warn(
      `[createMessageCompat] OpenRouter unavailable (${e instanceof Error ? e.message.slice(0, 160) : e}) — ` +
        `falling back to direct Anthropic (model: ${params.model})`,
    )
    try {
      return await viaAnthropic(params)
    } catch (anthropicError) {
      throw new ProviderFallbackError(e, anthropicError)
    }
  }
}
