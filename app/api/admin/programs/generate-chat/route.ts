import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

// ─── Validation ──────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(5000),
})

const toolEventSchema = z.object({
  tool: z.string().optional(),
  summary: z.string().optional(),
})

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
  session_id: z.string().min(1).optional(),
  tool_events: z.array(toolEventSchema).max(20).optional(),
})

// ─── Rate limit ──────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 120_000

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(userId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  )
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps)
    return false
  }
  timestamps.push(now)
  rateLimitMap.set(userId, timestamps)
  return true
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth
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
        { error: "Too many requests. Please wait a few minutes." },
        { status: 429 }
      )
    }

    // Parse body
    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsed.error.issues },
        { status: 400 }
      )
    }

    // Create Firestore job doc
    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()

    await jobRef.set({
      type: "program_chat",
      status: "pending",
      input: {
        messages: parsed.data.messages,
        session_id: parsed.data.session_id ?? null,
        tool_events: parsed.data.tool_events ?? [],
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
    console.error("[Program Chat] Error:", error)
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    )
  }
}
