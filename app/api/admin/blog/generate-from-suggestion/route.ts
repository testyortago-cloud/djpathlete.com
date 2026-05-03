import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { getCalendarEntryById } from "@/lib/db/content-calendar"
import { proposePrimaryKeyword } from "@/lib/blog/keyword-proposal"
import { extractContentAngle } from "@/lib/blog/content-angle"

const requestSchema = z.object({
  calendarId: z.string().uuid().or(z.string().min(1)),
  // Deprecated alias kept for one release.
  tone: z.enum(["professional", "conversational", "motivational"]).optional(),
  register: z.enum(["formal", "casual"]).optional(),
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
    const { calendarId, tone, register, length } = parsed.data
    const resolvedRegister: "formal" | "casual" =
      register ?? (tone === "professional" ? "formal" : "casual")

    const entry = await getCalendarEntryById(calendarId)
    if (!entry || entry.entry_type !== "topic_suggestion") {
      return NextResponse.json({ error: "Topic suggestion not found." }, { status: 404 })
    }

    const meta = (entry.metadata ?? {}) as TopicMetadata
    const promptLines = [entry.title, meta.summary].filter(Boolean).join("\n\n")
    const referenceUrls = meta.tavily_url ? [meta.tavily_url] : []

    const [proposedKeyword, contentAngle] = await Promise.all([
      proposePrimaryKeyword({ title: entry.title, summary: meta.summary }),
      extractContentAngle({ title: entry.title, summary: meta.summary }),
    ])
    console.log(
      `[generate-from-suggestion] keyword="${proposedKeyword}" angle=${contentAngle ? "yes" : "no"} for "${entry.title}"`,
    )

    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "blog_generation",
      status: "pending",
      input: {
        prompt: promptLines,
        register: resolvedRegister,
        length,
        primary_keyword: proposedKeyword,
        ...(contentAngle ? { content_angle: contentAngle } : {}),
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
