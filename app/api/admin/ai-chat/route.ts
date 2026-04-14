import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { aiChatSchema } from "@/lib/validators/ai-chat"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { createServiceRoleClient } from "@/lib/supabase"
import { AI_CHAT_RATE_LIMIT_MAX, AI_CHAT_RATE_LIMIT_WINDOW_MS, AI_CHAT_MAX_CONVERSATIONS } from "@/lib/admin-ai-config"

// In-memory per-user rate limiter
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(userId) ?? []).filter((t) => now - t < AI_CHAT_RATE_LIMIT_WINDOW_MS)
  if (timestamps.length >= AI_CHAT_RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps)
    return false
  }
  timestamps.push(now)
  rateLimitMap.set(userId, timestamps)
  return true
}

// ─── GET: Fetch conversation history from Supabase ──────────────────────────

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }
    const userId = session.user.id

    const supabase = createServiceRoleClient()

    // Fetch all admin_chat messages for this user, ordered by creation time
    const { data: messages, error } = await supabase
      .from("ai_conversation_history")
      .select("id, session_id, role, content, created_at, metadata")
      .eq("user_id", userId)
      .eq("feature", "admin_chat")
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[Admin AI Chat] DB fetch error:", error)
      return NextResponse.json({ error: "Failed to fetch conversations." }, { status: 500 })
    }

    // Group messages by session_id into conversations
    const sessionMap = new Map<
      string,
      {
        session_id: string
        messages: Array<{
          role: string
          content: string
          created_at: string
        }>
        created_at: string
        updated_at: string
      }
    >()

    for (const msg of messages ?? []) {
      if (!msg.session_id) continue

      let convo = sessionMap.get(msg.session_id)
      if (!convo) {
        convo = {
          session_id: msg.session_id,
          messages: [],
          created_at: msg.created_at,
          updated_at: msg.created_at,
        }
        sessionMap.set(msg.session_id, convo)
      }

      convo.messages.push({
        role: msg.role,
        content: msg.content,
        created_at: msg.created_at,
      })
      convo.updated_at = msg.created_at
    }

    // Convert to array, sort by most recent, limit count
    const conversations = Array.from(sessionMap.values())
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, AI_CHAT_MAX_CONVERSATIONS)
      .map((convo) => {
        // Derive title from first user message
        const firstUserMsg = convo.messages.find((m) => m.role === "user")
        const title = firstUserMsg ? firstUserMsg.content.slice(0, 60) : "Chat"

        return {
          session_id: convo.session_id,
          title,
          messages: convo.messages,
          created_at: convo.created_at,
          updated_at: convo.updated_at,
        }
      })

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error("[Admin AI Chat] GET error:", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}

// ─── POST: Send message ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth: admin only
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }
    const userId = session.user.id

    // Rate limit
    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 },
      )
    }

    // Parse & validate body
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
        { status: 400 },
      )
    }

    const { messages, model, session_id } = parsed.data

    // Create Firestore job doc
    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()

    await jobRef.set({
      type: "admin_chat",
      status: "pending",
      input: {
        messages,
        model,
        ...(session_id ? { session_id } : {}),
        userId,
      },
      result: null,
      error: null,
      userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
  } catch (error) {
    console.error("[Admin AI Chat] Error:", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
