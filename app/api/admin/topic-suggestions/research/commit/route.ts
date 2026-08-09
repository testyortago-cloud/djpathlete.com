// app/api/admin/topic-suggestions/research/commit/route.ts
// POST { topics } — writes admin-selected candidates from the on-demand
// research preview into content_calendar as ordinary topic_suggestion rows.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createResearchedTopicSuggestions } from "@/lib/db/content-calendar"
import { canAccessAdminPath } from "@/lib/permissions/guard"

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

  const today = new Date().toISOString().slice(0, 10)
  const entries = await createResearchedTopicSuggestions(parsed.data.topics, today)
  return NextResponse.json({ entries }, { status: 201 })
}
