import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { aiChatSchema } from "@/lib/validators/ai-chat"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import {
  AI_CHAT_RATE_LIMIT_MAX,
  AI_CHAT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/admin-ai-config"

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
  try {
    // Auth: admin only
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized. Admin access required." },
        { status: 403 }
      )
    }
    const userId = session.user.id

    // Rate limit
    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
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
        { status: 400 }
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

    return NextResponse.json(
      { jobId: jobRef.id, status: "pending" },
      { status: 202 }
    )
  } catch (error) {
    console.error("[Admin AI Chat] Error:", error)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    )
  }
}
