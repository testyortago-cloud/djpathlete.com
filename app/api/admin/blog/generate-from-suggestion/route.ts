import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { getCalendarEntryById } from "@/lib/db/content-calendar"

const requestSchema = z.object({
  calendarId: z.string().uuid().or(z.string().min(1)),
  tone: z.enum(["professional", "conversational", "motivational"]).optional().default("professional"),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
})

interface TopicMetadata {
  tavily_url?: string
  summary?: string
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const userId = session.user.id

    const body = await request.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request.",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      )
    }
    const { calendarId, tone, length } = parsed.data

    const entry = await getCalendarEntryById(calendarId)
    if (!entry || entry.entry_type !== "topic_suggestion") {
      return NextResponse.json({ error: "Topic suggestion not found." }, { status: 404 })
    }

    const meta = (entry.metadata ?? {}) as TopicMetadata
    const promptLines = [entry.title, meta.summary].filter(Boolean).join("\n\n")
    const referenceUrls = meta.tavily_url ? [meta.tavily_url] : []

    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "blog_generation",
      status: "pending",
      input: {
        prompt: promptLines,
        tone,
        length,
        userId,
        sourceCalendarId: calendarId,
        ...(referenceUrls.length ? { references: { urls: referenceUrls } } : {}),
      },
      result: null,
      error: null,
      userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({ jobId: jobRef.id, status: "pending" }, { status: 202 })
  } catch (error) {
    console.error("[generate-from-suggestion]", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
