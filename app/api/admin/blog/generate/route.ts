import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60_000

const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, timestamps)
    return false
  }
  timestamps.push(now)
  rateLimitMap.set(userId, timestamps)
  return true
}

const blogGenerateSchema = z.object({
  prompt: z
    .string()
    .min(10, "Describe the blog post in at least 10 characters")
    .max(2000, "Prompt must be under 2000 characters"),
  tone: z.enum(["professional", "conversational", "motivational"]).optional().default("professional"),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
  references: z
    .object({
      urls: z.array(z.string().url()).max(5).optional().default([]),
      notes: z.string().max(10_000).optional().default(""),
      file_contents: z
        .array(
          z.object({
            name: z.string(),
            content: z.string().max(50_000),
          }),
        )
        .max(3)
        .optional()
        .default([]),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const userId = session.user.id

    if (!checkRateLimit(userId)) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 })
    }

    const body = await request.json()
    const parsed = blogGenerateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    const { prompt, tone, length, references } = parsed.data

    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()

    await jobRef.set({
      type: "blog_generation",
      status: "pending",
      input: { prompt, tone, length, userId, ...(references ? { references } : {}) },
      result: null,
      error: null,
      userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
  } catch (error) {
    console.error("[Blog Generate] Error:", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
