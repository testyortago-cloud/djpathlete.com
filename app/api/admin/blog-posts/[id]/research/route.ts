// app/api/admin/blog-posts/[id]/research/route.ts
// POST { topic } — kicks off a Tavily research ai_job for the given blog post.
// The tavilyResearch Firebase Function persists the brief back into
// blog_posts.tavily_research on completion.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getBlogPostById } from "@/lib/db/blog-posts"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const body = (await request.json().catch(() => null)) as { topic?: string } | null
  const topic = body?.topic?.trim()
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 })
  }

  try {
    await getBlogPostById(id)
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === "PGRST116") {
      return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
    }
    throw err
  }

  const { jobId, status } = await createAiJob({
    type: "tavily_research",
    userId: session.user.id,
    input: { topic, blog_post_id: id },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
