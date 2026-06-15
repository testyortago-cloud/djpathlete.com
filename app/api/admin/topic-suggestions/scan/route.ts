import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"

/**
 * On-demand "run now" override for the weekly trending scan. Enqueues a
 * tavily_trending_scan ai_job (the same job the Monday cron creates), which the
 * deployed Firebase `tavilyTrendingScan` function picks up, reads the saved
 * blog_scan_queries, and writes fresh topic suggestions to content_calendar.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_trending_scan",
    userId: session.user.id,
    input: {},
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
