// app/api/admin/topic-suggestions/research/commit/route.ts
// POST { topics } — writes admin-selected candidates from the on-demand
// research preview into content_calendar as ordinary topic_suggestion rows.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createResearchedTopicSuggestions } from "@/lib/db/content-calendar"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { briefMondayISO } from "@/lib/blog/scan-topics"
import { addScanTopic } from "@/lib/blog/scan-topics-store"

const schema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        summary: z.string().trim().min(1),
        tavily_url: z.string().trim().url(),
        rank: z.number(),
      }),
    )
    .min(1, "Select at least one topic")
    .max(10, "Too many topics at once"),
  /** What the coach researched; it becomes a weekly scan topic. */
  subject: z.string().trim().min(3).max(300).optional(),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
  }

  // Dated like the weekly scan's cards, so they sit in the same week's brief rather than in the archive.
  const entries = await createResearchedTopicSuggestions(parsed.data.topics, briefMondayISO(new Date()))
  // The subject also becomes a weekly scan topic. A failure there must not undo the cards just added.
  const scanTopic = parsed.data.subject
    ? await addScanTopic(parsed.data.subject, "research", session.user.id).catch((err) => {
        console.error("[topic-suggestions/research/commit] adding the scan topic failed:", err)
        return null
      })
    : null
  return NextResponse.json({ entries, scan_topic: scanTopic }, { status: 201 })
}
