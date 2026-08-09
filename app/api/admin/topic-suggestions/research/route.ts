// POST { topic } — kicks off an on-demand Tavily research ai_job for a single
// admin-typed topic. The topicResearchScan Firebase Function writes candidate
// topics back into the job's `result` for preview (see the commit route for
// turning selected candidates into content_calendar rows).

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const schema = z.object({
  topic: z.string().trim().min(5, "Give the topic a few more words").max(200),
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

  const { jobId, status } = await createAiJob({
    type: "topic_research_scan",
    userId: session.user.id,
    input: { topic: parsed.data.topic },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
