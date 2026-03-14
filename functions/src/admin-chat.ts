import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { streamWithTools, MODEL_SONNET, MODEL_HAIKU } from "./ai/anthropic.js"
import { ADMIN_TOOLS, TOOL_LABELS, executeAdminTool } from "./ai/admin-tools.js"
import { retrieveSimilarContext, formatRagContext, embedConversationMessage } from "./ai/rag.js"
import { getSupabase } from "./lib/supabase.js"

const AI_CHAT_API_MESSAGE_LIMIT = 10

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the AI assistant for DJP Athlete, a fitness coaching platform run by Darren Paul, a strength & conditioning coach with 20+ years of experience.

You help Darren manage his business by looking up real-time data using the tools available to you.

Guidelines:
- ALWAYS use tools to look up current data before answering — do NOT guess or use outdated information
- Be concise, direct, and data-driven
- Use exact numbers and client names from tool results
- Proactively suggest actions to improve client retention and revenue
- When multiple tools are needed, call them all to get a complete picture
- Identify patterns and trends in the data
- When suggesting actions, be specific about which clients or programs you mean

Current date: ${new Date().toLocaleDateString()}`

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleAdminChat(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)
  const chunksRef = jobRef.collection("chunks")
  let chunkIndex = 0

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "streaming", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    messages: Array<{ role: "user" | "assistant"; content: string }>
    model?: string
    session_id?: string
    userId: string
  }

  const startTime = Date.now()
  const userId = input.userId
  const sessionId = input.session_id ?? `admin-chat-${userId}-${Date.now()}`

  try {
    // Trim history to recent messages
    const recentMessages = input.messages.slice(-AI_CHAT_API_MESSAGE_LIMIT)

    // Choose model
    let model: string
    if (input.model === "haiku") {
      model = MODEL_HAIKU
    } else if (input.model === "sonnet") {
      model = MODEL_SONNET
    } else {
      const lastUserMsg = recentMessages.filter((m) => m.role === "user").pop()
      const queryLength = lastUserMsg?.content.length ?? 0
      const isSimpleQuery = queryLength < 80 && recentMessages.length <= 4
      model = isSimpleQuery ? MODEL_HAIKU : MODEL_SONNET
    }

    // System prompt blocks
    const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [
      {
        type: "text" as const,
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" as const },
      },
    ]

    // RAG context from past conversations
    const lastUserMsgForRag = recentMessages.filter((m) => m.role === "user").pop()
    if (lastUserMsgForRag) {
      const ragResults = await retrieveSimilarContext(
        lastUserMsgForRag.content,
        "admin_chat",
        { excludeSession: sessionId, threshold: 0.5, limit: 3 }
      )
      const ragContext = formatRagContext(ragResults)
      if (ragContext) {
        systemBlocks.push({ type: "text", text: ragContext })
      }
    }

    // Stream with tools
    let accumulatedText = ""
    let tokensInput = 0
    let tokensOutput = 0

    const stream = streamWithTools({
      system: systemBlocks,
      messages: recentMessages,
      tools: ADMIN_TOOLS,
      executeTool: executeAdminTool,
      toolLabels: TOOL_LABELS,
      maxTokens: 4096,
      model,
      maxToolRounds: 5,
    })

    for await (const event of stream) {
      if (event.type === "text") {
        accumulatedText += event.text
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "delta",
          data: { text: event.text },
          createdAt: FieldValue.serverTimestamp(),
        })
      } else if (event.type === "tool_start") {
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "tool_start",
          data: { name: event.name, label: event.label ?? event.name },
          createdAt: FieldValue.serverTimestamp(),
        })
      } else if (event.type === "tool_result") {
        await chunksRef.doc(String(chunkIndex++).padStart(6, "0")).set({
          index: chunkIndex - 1,
          type: "tool_result",
          data: { name: event.name },
          createdAt: FieldValue.serverTimestamp(),
        })
      } else if (event.type === "usage") {
        tokensInput = event.input_tokens
        tokensOutput = event.output_tokens
      }
    }

    // Save conversation history to Supabase
    const supabase = getSupabase()
    const lastUserMsg = recentMessages.filter((m) => m.role === "user").pop()
    try {
      const batch: Array<Record<string, unknown>> = []
      if (lastUserMsg) {
        batch.push({
          user_id: userId,
          feature: "admin_chat",
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
        feature: "admin_chat",
        session_id: sessionId,
        role: "assistant",
        content: accumulatedText,
        metadata: { model, tools_used: true },
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        model_used: model,
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
      // Conversation save failure is non-fatal
    }

    // Log generation
    const tokensUsed = tokensInput + tokensOutput
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: userId,
        status: "completed",
        input_params: { feature: "admin_chat", tools_used: true },
        output_summary: null,
        error_message: null,
        model_used: model,
        tokens_used: tokensUsed,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch { /* non-fatal */ }

    // Done chunk
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
    console.error(`[admin-chat] Job ${jobId} failed:`, errorMessage)

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
