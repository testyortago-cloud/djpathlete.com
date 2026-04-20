// app/api/admin/newsletter/generate-from-blog/route.ts
// POST { blog_post_id, tone?, length? } — queues an AI newsletter draft from a blog post.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { getBlogPostById } from "@/lib/db/blog-posts"

const ALLOWED_TONES = ["professional", "conversational", "motivational"] as const
const ALLOWED_LENGTHS = ["short", "medium", "long"] as const
type Tone = (typeof ALLOWED_TONES)[number]
type Length = (typeof ALLOWED_LENGTHS)[number]

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    blog_post_id?: string
    tone?: string
    length?: string
  } | null
  const blogPostId = body?.blog_post_id
  if (!blogPostId) {
    return NextResponse.json({ error: "blog_post_id is required" }, { status: 400 })
  }
  const tone: Tone = (ALLOWED_TONES as readonly string[]).includes(body?.tone ?? "")
    ? (body!.tone as Tone)
    : "professional"
  const length: Length = (ALLOWED_LENGTHS as readonly string[]).includes(body?.length ?? "")
    ? (body!.length as Length)
    : "medium"

  try {
    await getBlogPostById(blogPostId)
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === "PGRST116") {
      return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
    }
    throw err
  }

  const { jobId, status } = await createAiJob({
    type: "newsletter_from_blog",
    userId: session.user.id,
    input: { blog_post_id: blogPostId, tone, length },
  })

  return NextResponse.json({ jobId, status }, { status: 202 })
}
