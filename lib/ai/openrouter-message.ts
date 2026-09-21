import Anthropic from "@anthropic-ai/sdk"
import {
  getOpenRouterClient,
  isOpenRouterConfigured,
  shouldFallBackToAnthropic,
  toOpenRouterModel,
} from "@/lib/ai/openrouter"

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
 * NOT supported: streaming. Nothing that goes through here streams.
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
function toOpenAIMessages(
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

function toOpenAITools(tools: CompatTool[]) {
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

  const completion = await client.chat.completions.create({
    model: toOpenRouterModel(params.model),
    max_tokens: params.max_tokens,
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.tools ? { tools: toOpenAITools(params.tools) } : {}),
    ...(params.tool_choice ? { tool_choice: toOpenAIToolChoice(params.tool_choice) } : {}),
    messages: messages as never,
  })

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

async function viaAnthropic(params: CompatMessageParams): Promise<CompatMessage> {
  const res = await anthropicClient().messages.create({
    model: params.model,
    max_tokens: params.max_tokens,
    ...(params.system ? { system: params.system } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
    messages: params.messages,
  } as never)

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

export async function createMessageCompat(params: CompatMessageParams): Promise<CompatMessage> {
  if (!isOpenRouterConfigured()) return viaAnthropic(params)
  try {
    return await viaOpenRouter(params)
  } catch (e) {
    // Provider availability only. A 400 is our own malformed request and fails
    // identically on Anthropic, so re-throw rather than pay for it twice.
    if (!shouldFallBackToAnthropic(e)) throw e
    console.warn(
      `[createMessageCompat] OpenRouter unavailable (${e instanceof Error ? e.message.slice(0, 160) : e}) — ` +
        `falling back to direct Anthropic (model: ${params.model})`,
    )
    return viaAnthropic(params)
  }
}
