import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getClient, MODEL_SONNET, MODEL_HAIKU, Anthropic } from "./ai/anthropic.js"
import { getProgramChatSystemPrompt } from "./ai/program-chat-prompt.js"
import { listClients, lookupClientProfile, getExercisesForAI } from "./ai/program-chat-tools.js"
import { generateProgramSync } from "./ai/orchestrator.js"
import type { AiGenerationRequest, PipelineProgressCallback } from "./ai/orchestrator.js"
import { retrieveSimilarContext, formatRagContext, buildRagAugmentedPrompt, embedConversationMessage } from "./ai/rag.js"
import { getSupabase } from "./lib/supabase.js"
import pRetry from "p-retry"

// ─── Transient error detection ────────────────────────────────────────────────

function isTransientError(error: unknown): boolean {
  const statusCode = (error as { status?: number }).status
  if (typeof statusCode === "number") {
    return statusCode === 429 || statusCode === 529 || statusCode >= 500
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("429") || msg.includes("529") || msg.includes("overloaded") || msg.includes("500") || msg.includes("502") || msg.includes("503")) {
      return true
    }
  }
  return false
}

// ─── Retry-wrapped messages.create with Haiku fallback ────────────────────────

async function createWithRetry(
  client: Anthropic,
  params: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "model">,
  primaryModel: string = MODEL_SONNET
): Promise<Anthropic.Messages.Message> {
  try {
    return await pRetry(
      () => client.messages.create({ ...params, model: primaryModel }),
      {
        retries: 3,
        minTimeout: 3_000,
        maxTimeout: 15_000,
        shouldRetry: (err) => isTransientError(err),
        onFailedAttempt: (ctx) => {
          console.warn(`[program-chat] Attempt ${ctx.attemptNumber} failed (${ctx.retriesLeft} left, model: ${primaryModel}): ${ctx.error.message}`)
        },
      }
    )
  } catch (error) {
    // If primary model exhausted retries on transient error, fall back to Haiku
    if (primaryModel !== MODEL_HAIKU && isTransientError(error)) {
      console.warn(`[program-chat] ${primaryModel} exhausted retries — falling back to ${MODEL_HAIKU}`)
      return await pRetry(
        () => client.messages.create({ ...params, model: MODEL_HAIKU }),
        {
          retries: 2,
          minTimeout: 2_000,
          maxTimeout: 10_000,
          shouldRetry: (err) => isTransientError(err),
          onFailedAttempt: (ctx) => {
            console.warn(`[program-chat] Haiku attempt ${ctx.attemptNumber} failed (${ctx.retriesLeft} left): ${ctx.error.message}`)
          },
        }
      )
    }
    throw error
  }
}

// Tool definitions for Anthropic API
const TOOL_DEFINITIONS: Anthropic.Messages.Tool[] = [
  {
    name: "list_clients",
    description: "List all clients on the platform with their IDs and names. Call this when you need to find a client or see who is available.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "lookup_client_profile",
    description: "Look up a specific client's detailed profile including goals, experience, equipment, injuries, and training preferences. Call this after identifying a client to get their full details before generating a program.",
    input_schema: {
      type: "object" as const,
      properties: {
        client_id: { type: "string", description: "The UUID of the client" },
        client_name: { type: "string", description: "The name of the client (for display)" },
      },
      required: ["client_id", "client_name"],
    },
  },
  {
    name: "propose_parameters",
    description: "Present proposed program parameters to the admin for confirmation. The UI will show interactive 'Generate' and 'Modify' buttons. ALWAYS use this instead of writing parameters as plain text.",
    input_schema: {
      type: "object" as const,
      properties: {
        client_id: { type: "string", description: "The UUID of the client (null for generic programs)" },
        client_name: { type: "string", description: "The client's name (for display)" },
        goals: { type: "array", items: { type: "string" }, description: "Training goals" },
        duration_weeks: { type: "number", description: "Program length in weeks" },
        sessions_per_week: { type: "number", description: "Training sessions per week" },
        session_minutes: { type: "number", description: "Session duration in minutes" },
        split_type: { type: "string", description: "Split type" },
        periodization: { type: "string", description: "Periodization type" },
        additional_instructions: { type: "string", description: "Extra instructions or notes" },
        equipment_override: { type: "array", items: { type: "string" }, description: "Available equipment" },
      },
      required: ["goals", "duration_weeks", "sessions_per_week"],
    },
  },
  {
    name: "generate_program",
    description: "Generate a full training program for a client using AI. Call this once you have gathered enough information about the client's needs.",
    input_schema: {
      type: "object" as const,
      properties: {
        client_id: { type: "string", description: "The UUID of the client (null for generic programs)" },
        goals: { type: "array", items: { type: "string" }, description: "Training goals" },
        duration_weeks: { type: "number", description: "Program length in weeks" },
        sessions_per_week: { type: "number", description: "Training sessions per week" },
        session_minutes: { type: "number", description: "Session duration in minutes" },
        split_type: { type: "string", description: "Split type (optional)" },
        periodization: { type: "string", description: "Periodization type (optional)" },
        additional_instructions: { type: "string", description: "Extra instructions (optional)" },
      },
      required: ["goals", "duration_weeks", "sessions_per_week"],
    },
  },
]

const MAX_TOOL_ROUNDS = 5

// ─── State compression ──────────────────────────────────────────────────────
// Firestore has a 1MB document limit. Tool results (client lists, profiles)
// can be very large. Compress them to summaries before persisting state.

function compressToolResult(toolName: string, raw: string): string {
  try {
    const parsed = JSON.parse(raw)

    if (toolName === "list_clients" && Array.isArray(parsed.clients)) {
      // Keep only id + name — strip emails and other fields
      const short = parsed.clients.map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.full_name ?? c.name ?? c.email,
      }))
      return JSON.stringify({ clients: short, count: short.length })
    }

    if (toolName === "lookup_client_profile") {
      // Keep the essential profile fields, drop verbose nested data
      const keep: Record<string, unknown> = {}
      for (const key of [
        "client_id", "client_name", "goals", "experience_level",
        "training_age_category", "preferred_training_days",
        "preferred_session_minutes", "available_equipment",
        "injuries", "limitations", "preferences", "notes",
      ]) {
        if (parsed[key] !== undefined) keep[key] = parsed[key]
      }
      return JSON.stringify(keep)
    }

    // generate_program results are already small (just success/program_id)
    return raw
  } catch {
    return raw
  }
}

function compressApiMessages(
  messages: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

    const compressed = msg.content.map((block) => {
      if (
        typeof block === "object" &&
        "type" in block &&
        block.type === "tool_result" &&
        typeof (block as Anthropic.Messages.ToolResultBlockParam).content === "string"
      ) {
        const tr = block as Anthropic.Messages.ToolResultBlockParam
        // Find the tool name from the tool_use_id — we tag it during execution
        const content = tr.content as string
        // Try to detect tool name from the content shape
        let toolName = "unknown"
        if (content.includes('"clients"')) toolName = "list_clients"
        else if (content.includes('"client_id"') || content.includes('"goals"')) toolName = "lookup_client_profile"
        else if (content.includes('"program_id"')) toolName = "generate_program"

        return { ...tr, content: compressToolResult(toolName, content) }
      }
      return block
    })
    return { ...msg, content: compressed }
  })
}

// ─── Context summary fallback ───────────────────────────────────────────────
// When Firestore state is missing (save failed or expired), build a summary
// from the text messages so the AI retains context about what happened.

function buildConversationSummary(
  textMessages: Array<{ role: "user" | "assistant"; content: string }>,
  toolEvents?: Array<{ tool?: string; summary?: string }>
): string {
  if (textMessages.length <= 2 && (!toolEvents || toolEvents.length === 0)) return ""

  const parts: string[] = []
  parts.push("## Previous Conversation Summary")
  parts.push("The following is a summary of what was discussed so far in this conversation:")
  parts.push("")

  for (const msg of textMessages.slice(0, -1)) { // exclude the latest user message (already in messages array)
    const prefix = msg.role === "user" ? "**Darren:**" : "**You (AI):**"
    // Keep assistant messages longer since they contain proposed parameters
    const maxLen = msg.role === "assistant" ? 1500 : 500
    const content = msg.content.length > maxLen
      ? msg.content.slice(0, maxLen) + "... [truncated]"
      : msg.content
    parts.push(`${prefix} ${content}`)
  }

  // Include tool call history so the AI knows what tools were already used
  if (toolEvents && toolEvents.length > 0) {
    parts.push("")
    parts.push("## Tools Already Called (DO NOT re-call these)")
    for (const evt of toolEvents) {
      if (evt.tool) {
        parts.push(`- **${evt.tool}**: ${evt.summary ?? "completed"}`)
      }
    }
  }

  parts.push("")
  parts.push("CRITICAL: Continue the conversation naturally. Do NOT re-call tools you already used — the results are summarized above. Do NOT repeat or re-summarize information you already shared. If you already proposed program parameters and the user confirmed (e.g. 'sounds good', 'yes', 'go ahead'), call generate_program IMMEDIATELY with those parameters — do NOT re-display them.")

  return parts.join("\n")
}

export async function handleProgramChat(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)
  const chunksRef = jobRef.collection("chunks")
  let chunkIndex = 0

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  // Double-check not cancelled between creation and pickup
  const freshSnap = await jobRef.get()
  if (freshSnap.data()?.status === "cancelled") {
    console.log(`[program-chat] Job ${jobId} was cancelled before processing`)
    return
  }

  await jobRef.update({ status: "streaming", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    messages: Array<{ role: "user" | "assistant"; content: string }>
    session_id?: string
    tool_events?: Array<{ tool?: string; summary?: string }>
    userId: string
  }

  const startTime = Date.now()
  const userId = input.userId
  const sessionId = input.session_id ?? `program-chat-${userId}-${Date.now()}`

  try {
    const recentMessages = input.messages.slice(-20)
    let systemPrompt = getProgramChatSystemPrompt()

    // RAG
    const lastUserMsgForRag = recentMessages.filter((m) => m.role === "user").pop()
    if (lastUserMsgForRag) {
      const ragResults = await retrieveSimilarContext(
        lastUserMsgForRag.content,
        "program_chat",
        { excludeSession: sessionId, threshold: 0.5, limit: 2 }
      )
      const ragContext = formatRagContext(ragResults)
      if (ragContext) {
        systemPrompt = buildRagAugmentedPrompt(systemPrompt, ragContext)
      }
    }

    const client = getClient()
    let accumulatedText = ""
    const toolCalls: { tool: string; result: unknown }[] = []
    let tokensInput = 0
    let tokensOutput = 0

    // Load previous API state (includes tool_use/tool_result blocks) or start fresh
    let apiMessages: Anthropic.Messages.MessageParam[]
    const stateRef = db.collection("ai_chat_state").doc(sessionId)
    const stateSnap = await stateRef.get()

    if (stateSnap.exists) {
      // Resume from stored state — append only the latest user message
      apiMessages = stateSnap.data()!.apiMessages as Anthropic.Messages.MessageParam[]
      const latestUserMsg = recentMessages.filter((m) => m.role === "user").pop()
      if (latestUserMsg) {
        apiMessages.push({ role: "user", content: latestUserMsg.content })
      }
      console.log(`[program-chat] Resumed session ${sessionId} with ${apiMessages.length} messages`)
    } else if (recentMessages.length > 2 || (input.tool_events && input.tool_events.length > 0)) {
      // State is missing but we have prior conversation — inject summary so AI keeps context
      const conversationSummary = buildConversationSummary(recentMessages, input.tool_events)
      if (conversationSummary) {
        systemPrompt += `\n\n${conversationSummary}`
      }
      // Only send the latest user message — the summary covers prior context
      const latestUserMsg = recentMessages.filter((m) => m.role === "user").pop()
      apiMessages = latestUserMsg
        ? [{ role: "user", content: latestUserMsg.content }]
        : []
      console.log(`[program-chat] State missing for session ${sessionId} — injected conversation summary (${recentMessages.length} messages)`)
    } else {
      // First turn — build from text messages
      apiMessages = recentMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))
      console.log(`[program-chat] New session ${sessionId} with ${apiMessages.length} messages`)
    }

    // Helper to check if the job was cancelled
    async function isCancelled(): Promise<boolean> {
      const snap = await jobRef.get()
      return snap.data()?.status === "cancelled"
    }

    // Track tools already called — prevents Claude from re-calling them
    const calledTools = new Set<string>()

    // From loaded state: scan for tool_use blocks
    for (const msg of apiMessages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "object" && "type" in block && block.type === "tool_use") {
            calledTools.add((block as Anthropic.Messages.ToolUseBlock).name)
          }
        }
      }
    }

    // From frontend tool events (fallback when state is missing)
    if (input.tool_events) {
      for (const evt of input.tool_events) {
        if (evt.tool) calledTools.add(evt.tool)
      }
    }

    if (calledTools.size > 0) {
      console.log(`[program-chat] Tools already called: ${[...calledTools].join(", ")}`)
    }

    // Tool use loop
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Check for cancellation between rounds
      if (round > 0 && await isCancelled()) {
        console.log(`[program-chat] Job ${jobId} cancelled between tool rounds`)
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "done",
          data: {},
          createdAt: FieldValue.serverTimestamp(),
        })
        return
      }

      // Remove already-called tools so Claude cannot re-call them
      // (generate_program is always allowed since it's the terminal action)
      const availableTools = TOOL_DEFINITIONS.filter(
        (t) => t.name === "generate_program" || !calledTools.has(t.name)
      )

      const response = await createWithRetry(client, {
        max_tokens: 4096,
        system: systemPrompt,
        messages: apiMessages,
        tools: availableTools,
      })

      tokensInput += response.usage?.input_tokens ?? 0
      tokensOutput += response.usage?.output_tokens ?? 0

      // Process response content blocks
      const assistantContent: Anthropic.Messages.ContentBlock[] = response.content
      const toolUseBlocks: Anthropic.Messages.ToolUseBlock[] = []

      for (const block of assistantContent) {
        if (block.type === "text" && block.text) {
          accumulatedText += block.text
          await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
            index: chunkIndex - 1,
            type: "delta",
            data: { text: block.text },
            createdAt: FieldValue.serverTimestamp(),
          })
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block)

          await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
            index: chunkIndex - 1,
            type: "tool_start",
            data: { tool: block.name },
            createdAt: FieldValue.serverTimestamp(),
          })
        }
      }

      // If no tool use, we're done — but MUST push the assistant response
      // to apiMessages so state is preserved for the next turn
      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        apiMessages.push({ role: "assistant", content: assistantContent })
        break
      }

      // Execute tools and build tool results
      apiMessages.push({ role: "assistant", content: assistantContent })

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

      // Build a cache of previous tool results from apiMessages to avoid re-calling
      const previousToolResults = new Map<string, string>()
      for (const msg of apiMessages) {
        if (msg.role === "user" && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block === "object" && "type" in block && block.type === "tool_result") {
              const toolResult = block as Anthropic.Messages.ToolResultBlockParam
              if (typeof toolResult.content === "string") {
                // Find the matching tool_use to get the tool name + args
                for (const prevMsg of apiMessages) {
                  if (prevMsg.role === "assistant" && Array.isArray(prevMsg.content)) {
                    for (const aBlock of prevMsg.content) {
                      if (typeof aBlock === "object" && "type" in aBlock && aBlock.type === "tool_use" && (aBlock as Anthropic.Messages.ToolUseBlock).id === toolResult.tool_use_id) {
                        const tu = aBlock as Anthropic.Messages.ToolUseBlock
                        const cacheKey = `${tu.name}:${JSON.stringify(tu.input)}`
                        previousToolResults.set(cacheKey, toolResult.content)
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      for (const toolUse of toolUseBlocks) {
        let toolResult: Record<string, unknown>

        // Check cache for duplicate tool calls (skip re-executing list_clients / lookup_client_profile)
        const cacheKey = `${toolUse.name}:${JSON.stringify(toolUse.input)}`
        const cached = previousToolResults.get(cacheKey)

        if (cached && toolUse.name !== "generate_program") {
          console.log(`[program-chat] Returning cached result for ${toolUse.name}`)
          toolResult = JSON.parse(cached) as Record<string, unknown>
        } else {
          try {
            switch (toolUse.name) {
              case "list_clients":
                toolResult = await listClients()
                break
              case "lookup_client_profile": {
                const args = toolUse.input as { client_id: string; client_name: string }
                toolResult = await lookupClientProfile(args.client_id, args.client_name)
                break
              }
              case "propose_parameters": {
                const params = toolUse.input as Record<string, unknown>
                // Emit a parameters_proposed chunk so the frontend can show buttons
                await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
                  index: chunkIndex - 1,
                  type: "parameters_proposed",
                  data: params,
                  createdAt: FieldValue.serverTimestamp(),
                })
                toolResult = {
                  success: true,
                  summary: "Parameters shown to Darren with Generate/Modify buttons. Wait for his response.",
                }
                break
              }
              case "generate_program": {
                // Check cancellation before starting the expensive generation
                if (await isCancelled()) {
                  console.log(`[program-chat] Job ${jobId} cancelled before program generation`)
                  await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
                    index: chunkIndex - 1,
                    type: "done",
                    data: {},
                    createdAt: FieldValue.serverTimestamp(),
                  })
                  return
                }

                const rawArgs = toolUse.input as Record<string, unknown>
                // Sanitize client_id: model may pass "null", "", or an invalid value
                let clientId: string | null = typeof rawArgs.client_id === "string" ? rawArgs.client_id.trim() : null
                if (!clientId || clientId === "null" || clientId === "undefined" || clientId.length < 10) {
                  clientId = null
                }
                const args: AiGenerationRequest = { ...rawArgs, client_id: clientId } as AiGenerationRequest

                // Progress callback to emit pipeline step chunks for real-time UI
                const onProgress: PipelineProgressCallback = async (step, current, total, detail) => {
                  await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
                    index: chunkIndex - 1,
                    type: "pipeline_step",
                    data: { step, current, total, detail: detail ?? null },
                    createdAt: FieldValue.serverTimestamp(),
                  })
                }

                try {
                  const genResult = await generateProgramSync(args, userId, undefined, undefined, jobId, onProgress)
                  toolResult = {
                    success: true,
                    program_id: genResult.program_id,
                    validation_pass: genResult.validation.pass,
                    duration_ms: genResult.duration_ms,
                    summary: `Program created successfully (${genResult.duration_ms}ms).`,
                  }

                  await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
                    index: chunkIndex - 1,
                    type: "program_created",
                    data: {
                      programId: genResult.program_id,
                      validationPass: genResult.validation.pass,
                      durationMs: genResult.duration_ms,
                    },
                    createdAt: FieldValue.serverTimestamp(),
                  })
                } catch (genError) {
                  const errMsg = genError instanceof Error ? genError.message : "Generation failed"
                  toolResult = { success: false, summary: errMsg }

                  await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
                    index: chunkIndex - 1,
                    type: "tool_result",
                    data: { tool: toolUse.name, summary: errMsg, error: true },
                    createdAt: FieldValue.serverTimestamp(),
                  })
                }
                break
              }
              default:
                toolResult = { error: `Unknown tool: ${toolUse.name}` }
            }
          } catch (toolError) {
            toolResult = { error: toolError instanceof Error ? toolError.message : "Tool execution failed" }
          }
        }

        toolCalls.push({ tool: toolUse.name, result: toolResult })
        calledTools.add(toolUse.name)

        // Emit tool result chunk (for non-generate tools)
        if (toolUse.name !== "generate_program") {
          await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
            index: chunkIndex - 1,
            type: "tool_result",
            data: {
              tool: toolUse.name,
              summary: (toolResult.summary as string) ?? "Done",
            },
            createdAt: FieldValue.serverTimestamp(),
          })
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(toolResult),
        })
      }

      apiMessages.push({ role: "user", content: toolResults })
    }

    // Save conversation history to Supabase
    const supabase = getSupabase()
    const lastUserMsg = recentMessages.filter((m) => m.role === "user").pop()
    try {
      const batch: Array<Record<string, unknown>> = []
      if (lastUserMsg) {
        batch.push({
          user_id: userId,
          feature: "program_chat",
          session_id: sessionId,
          role: "user",
          content: lastUserMsg.content,
          metadata: {},
          tokens_input: null,
          tokens_output: null,
          model_used: null,
        })
      }
      batch.push({
        user_id: userId,
        feature: "program_chat",
        session_id: sessionId,
        role: "assistant",
        content: accumulatedText || "[tool calls only]",
        metadata: { model: MODEL_SONNET, tool_calls: toolCalls },
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        model_used: MODEL_SONNET,
      })

      const { data: saved } = await supabase
        .from("ai_conversation_history")
        .insert(batch)
        .select()

      const assistantMsg = saved?.find((m: Record<string, unknown>) => m.role === "assistant")
      if (assistantMsg) {
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "message_id",
          data: { id: assistantMsg.id },
          createdAt: FieldValue.serverTimestamp(),
        })
        embedConversationMessage(assistantMsg.id).catch(() => {})
      }
    } catch {
      // Non-fatal
    }

    // Log generation
    const tokensUsed = tokensInput + tokensOutput
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: userId,
        status: "completed",
        input_params: { feature: "program_chat_builder" },
        output_summary: null,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: tokensUsed,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch { /* non-fatal */ }

    // Persist compressed API messages for next turn (avoids Firestore 1MB limit)
    try {
      const compressed = compressApiMessages(apiMessages)
      const statePayload = JSON.stringify({ apiMessages: compressed, userId })
      const payloadSizeKB = Math.round(statePayload.length / 1024)
      console.log(`[program-chat] Saving chat state: ${payloadSizeKB}KB, ${compressed.length} messages`)

      if (payloadSizeKB > 900) {
        console.warn(`[program-chat] Chat state is ${payloadSizeKB}KB — near Firestore 1MB limit, may fail`)
      }

      await stateRef.set({
        apiMessages: compressed,
        userId,
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (e) {
      console.error(`[program-chat] FAILED to save chat state for session ${sessionId}:`, e instanceof Error ? e.message : e)
      // State will be missing next turn — the summary fallback will kick in
    }

    // Done
    await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
      index: chunkIndex - 1,
      type: "done",
      data: {},
      createdAt: FieldValue.serverTimestamp(),
    })

    await jobRef.update({
      status: "completed",
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[program-chat] Job ${jobId} failed:`, errorMessage)

    await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
      index: chunkIndex - 1,
      type: "error",
      data: { message: errorMessage },
      createdAt: FieldValue.serverTimestamp(),
    })

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
