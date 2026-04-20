// app/api/admin/internal/tavily-trending/route.ts
// Internal cron endpoint hit weekly by GitHub Actions.
// Guarded by INTERNAL_CRON_TOKEN (shared with publish-due cron).

import { NextRequest, NextResponse } from "next/server"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""

  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_trending_scan",
    userId: "__cron__",
    input: {},
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
