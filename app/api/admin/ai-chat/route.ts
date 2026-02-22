import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildAdminContext } from "@/lib/admin-ai-context"
import { aiChatSchema } from "@/lib/validators/ai-chat"
import { streamChat, MODEL_SONNET, MODEL_HAIKU, Anthropic } from "@/lib/ai/anthropic"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import {
  AI_CHAT_CONTEXT_TIMEOUT_MS,
  AI_CHAT_RATE_LIMIT_MAX,
  AI_CHAT_RATE_LIMIT_WINDOW_MS,
  AI_CHAT_API_MESSAGE_LIMIT,
} from "@/lib/admin-ai-config"

export const maxDuration = 30

// In-memory per-user rate limiter
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(userId) ?? []).filter(
    (t) => now - t < AI_CHAT_RATE_LIMIT_WINDOW_MS
  )
  if (timestamps.length >= AI_CHAT_RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps)
    return false
  }
  timestamps.push(now)
  rateLimitMap.set(userId, timestamps)
  return true
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    // ── Auth: admin only ──────────────────────────────────────────────────
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized. Admin access required." },
        { status: 403 }
      )
    }
    userId = session.user.id

    // ── Rate limit ────────────────────────────────────────────────────────
    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }

    // ── Parse & validate body ─────────────────────────────────────────────
    const body = await request.json()
    const parsed = aiChatSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request body.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      )
    }

    const { messages, model: modelPref } = parsed.data

    // ── Build platform context (with timeout) ───────────────────────────
    let platformContext: string
    try {
      platformContext = await Promise.race([
        buildAdminContext(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Context build timed out")), AI_CHAT_CONTEXT_TIMEOUT_MS)
        ),
      ])
    } catch {
      platformContext =
        "[Platform data temporarily unavailable. Answer based on general knowledge.]"
    }

    // ── System prompt (structured blocks for prompt caching) ────────────
    const systemBlocks = [
      {
        type: "text" as const,
        text: `You are the AI assistant for DJP Athlete, a fitness coaching platform run by Darren Paul. You help the admin (Darren) manage his business by analyzing client data, revenue, and training progress.

You have access to real-time platform data shown below. Use this data to:
- Answer questions about clients, revenue, programs, and progress
- Proactively suggest actions to improve client retention and revenue
- Identify clients who need attention (inactive, stalled progress, etc.)
- Spot trends and opportunities
- Provide specific, actionable recommendations

Be concise, direct, and data-driven. Use exact numbers from the data. When suggesting actions, be specific about which clients or programs you're referring to.

Current date: ${new Date().toLocaleDateString()}`,
      },
      {
        type: "text" as const,
        text: platformContext,
        cache_control: { type: "ephemeral" as const },
      },
    ]

    // ── Trim history to save tokens ─────────────────────────────────────
    const recentMessages = messages.slice(-AI_CHAT_API_MESSAGE_LIMIT)

    // ── Choose model ──────────────────────────────────────────────────────
    let model: string
    if (modelPref === "haiku") {
      model = MODEL_HAIKU
    } else if (modelPref === "sonnet") {
      model = MODEL_SONNET
    } else {
      // Auto: Haiku for simple queries, Sonnet for complex
      const lastUserMsg = recentMessages.filter((m) => m.role === "user").pop()
      const queryLength = lastUserMsg?.content.length ?? 0
      const isSimpleQuery = queryLength < 80 && recentMessages.length <= 4
      model = isSimpleQuery ? MODEL_HAIKU : MODEL_SONNET
    }

    // ── Stream response via SSE ──────────────────────────────────────────
    const result = streamChat({
      system: systemBlocks,
      messages: recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      model,
    })

    const capturedUserId = userId
    const encoder = new TextEncoder()

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const text of result.textStream) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`)
            )
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`))
          controller.close()

          // Log usage (fire-and-forget)
          const usage = await result.usage
          const tokensUsed =
            (usage?.inputTokens ?? 0) +
            (usage?.outputTokens ?? 0)
          createGenerationLog({
            program_id: null,
            client_id: null,
            requested_by: capturedUserId,
            status: "completed",
            input_params: { feature: "admin_chat" },
            output_summary: null,
            error_message: null,
            model_used: model,
            tokens_used: tokensUsed,
            duration_ms: Date.now() - startTime,
            completed_at: new Date().toISOString(),
          }).catch(() => {})
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Stream error"
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message })}\n\n`
            )
          )
          controller.close()

          // Log failure (fire-and-forget)
          createGenerationLog({
            program_id: null,
            client_id: null,
            requested_by: capturedUserId,
            status: "failed",
            input_params: { feature: "admin_chat" },
            output_summary: null,
            error_message: message,
            model_used: model,
            tokens_used: null,
            duration_ms: Date.now() - startTime,
            completed_at: null,
          }).catch(() => {})
        }
      },
    })

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    console.error("[Admin AI Chat] Error:", error)

    const durationMs = Date.now() - startTime

    // Log failure (fire-and-forget)
    if (userId) {
      createGenerationLog({
        program_id: null,
        client_id: null,
        requested_by: userId,
        status: "failed",
        input_params: { feature: "admin_chat" },
        output_summary: null,
        error_message: error instanceof Error ? error.message : "Unknown error",
        model_used: MODEL_SONNET,
        tokens_used: null,
        duration_ms: durationMs,
        completed_at: null,
      }).catch(() => {})
    }

    // Handle Anthropic-specific errors
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: "AI rate limit reached. Please try again in a moment." },
          { status: 429 }
        )
      }
      return NextResponse.json(
        { error: "AI service error. Please try again." },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    )
  }
}
