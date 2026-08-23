// lib/ai/tool-loop.ts
// A NON-STREAMING Anthropic tool-use loop. It runs the model's tool rounds to
// completion and RETURNS the finished assistant turn instead of yielding it.
//
// ─── WHY THIS IS NOT A TWIN COPY ─────────────────────────────────────────────
//
// `functions/src/ai/anthropic.ts` already has `streamWithTools`, and the round
// loop below is deliberately shaped like it — same rounds, same
// assistant + tool_result message appending. It is still a DIFFERENT function,
// for two independent reasons:
//
//   1. Reach. `functions/` compiles with `rootDir: "src"` and cannot import
//      from `lib/`; a Next.js route cannot import out of `functions/` either.
//      The existing loop is simply unreachable from an app route, so there is
//      no version of this that shares code.
//
//   2. *** IT MUST NOT STREAM. *** This is the load-bearing reason. The caller
//      (the public chat assistant) validates the COMPLETE assistant turn —
//      every price, date and number in it — against the typed facts the
//      retrieval tools actually returned, and only then shows it. You cannot
//      validate prose you have already put on the visitor's screen: once a
//      fabricated price has been read, the only remedy left is retracting text
//      someone has already read. So the turn is buffered, returned, checked,
//      and shown last.
//
//      Do NOT "improve" this later by streaming it. Streaming deletes the
//      control, silently, with a green build and a nicer-feeling UI. The
//      widget's answer to the wait is a typing indicator carrying the tool
//      labels, not tokens on the screen.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §2.1

import Anthropic from "@anthropic-ai/sdk"

export type ToolCallRecord = { name: string; input: Record<string, unknown> }

export type ToolLoopResult = {
  /** The whole assistant turn, buffered. Nothing here has been shown yet. */
  text: string
  /** Every tool the model asked for, in order, including a round that was cut short. */
  toolCalls: ToolCallRecord[]
  tokensInput: number
  tokensOutput: number
  /**
   * The model still wanted tools when the round budget ran out, so it never got
   * to write an answer from them. RETURNED, not logged: only the caller knows
   * what that means for it. The chat route treats it as a blocked turn, because
   * a reply written without the lookups the model asked for is exactly the
   * ungrounded case the validator exists to catch.
   */
  stoppedOnRoundLimit: boolean
}

// Same lazy singleton as `getClient()` in lib/ai/anthropic.ts, kept local so a
// public unauthenticated route does not drag `@ai-sdk/anthropic`, `ai` and
// `p-retry` into its bundle for one constructor. No key check of our own: the
// SDK's own "ANTHROPIC_API_KEY is missing" error says it better than we would.
let _client: Anthropic | null = null

function getToolLoopClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

/**
 * What a failed lookup tells the model. Fixed wording, never the thrown error:
 * a database message is internal detail and the model would happily read it
 * out to a visitor.
 */
const TOOL_FAILURE_RESULT =
  "That lookup failed and returned nothing. Do not guess at what it would have said — tell the visitor you could not check, and offer to put them in touch with a person."

export async function runWithTools(opts: {
  system: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  tools: Anthropic.Tool[]
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>
  model: string
  maxTokens: number
  maxToolRounds: number
}): Promise<ToolLoopResult> {
  const client = getToolLoopClient()

  let apiMessages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const toolCalls: ToolCallRecord[] = []
  // Text from every round, not just the last: a model may write a sentence
  // before it reaches for a tool. Keeping it means everything the caller can
  // show is something the caller has validated — nothing is dropped unchecked,
  // and nothing unchecked is returned.
  const textParts: string[] = []
  let tokensInput = 0
  let tokensOutput = 0
  let stoppedOnRoundLimit = false

  for (let round = 0; round < opts.maxToolRounds; round++) {
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: apiMessages,
      tools: opts.tools,
    })

    tokensInput += message.usage.input_tokens
    tokensOutput += message.usage.output_tokens

    for (const block of message.content) {
      if (block.type === "text" && block.text) textParts.push(block.text)
    }

    if (message.stop_reason !== "tool_use") break

    const toolUseBlocks = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    if (toolUseBlocks.length === 0) break

    for (const block of toolUseBlocks) {
      toolCalls.push({ name: block.name, input: (block.input ?? {}) as Record<string, unknown> })
    }

    if (round === opts.maxToolRounds - 1) {
      // The model asked for more, and there is no round left in which it could
      // read the answer. Running the lookups now would cost real queries whose
      // results nothing will ever see, so stop and say so.
      stoppedOnRoundLimit = true
      break
    }

    const results = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const input = (block.input ?? {}) as Record<string, unknown>
        try {
          return { id: block.id, content: await opts.executeTool(block.name, input), isError: false }
        } catch (err) {
          // One failing lookup must not take down the whole turn — it comes
          // back as a tool_result the model can respond to. Logged loudly,
          // because a caught error nobody prints is a silent no-op.
          console.error(`[tool-loop] tool "${block.name}" threw:`, err)
          return { id: block.id, content: TOOL_FAILURE_RESULT, isError: true }
        }
      }),
    )

    const toolResultContent: Anthropic.ToolResultBlockParam[] = results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.id,
      content: r.content,
      ...(r.isError ? { is_error: true } : {}),
    }))

    apiMessages = [
      ...apiMessages,
      { role: "assistant" as const, content: message.content },
      { role: "user" as const, content: toolResultContent },
    ]
  }

  return {
    text: textParts.join("\n\n").trim(),
    toolCalls,
    tokensInput,
    tokensOutput,
    stoppedOnRoundLimit,
  }
}
