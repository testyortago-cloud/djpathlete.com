// app/api/admin/content/research/route.ts
// POST { topic, extractTopN?, searchDepth? } — triggers Tavily research.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { topic?: string; extractTopN?: number; searchDepth?: "basic" | "advanced" }
    | null
  const topic = body?.topic?.trim()
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 })
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_research",
    userId: session.user.id,
    input: {
      topic,
      extract_top_n: body?.extractTopN ?? 3,
      search_depth: body?.searchDepth ?? "basic",
    },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
