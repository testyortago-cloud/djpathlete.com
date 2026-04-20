import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { createAiJob } from "@/lib/ai-jobs"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const post = await getBlogPostById(id)

    const updated = await updateBlogPost(id, {
      status: "published",
      published_at: post.published_at ?? new Date().toISOString(),
    })

    // Queue an AI-drafted newsletter for admin review (replaces the old plain blast).
    // Fire-and-forget: if queuing fails, publishing still succeeds.
    createAiJob({
      type: "newsletter_from_blog",
      userId: session.user.id,
      input: { blog_post_id: id },
    }).catch((err) => console.error("[Blog] newsletter_from_blog queue failed:", err))

    // Queue SEO enrichment (parallel to newsletter_from_blog). Fire-and-forget.
    createAiJob({
      type: "seo_enhance",
      userId: session.user.id,
      input: { blog_post_id: id },
    }).catch((err) => console.error("[Blog] seo_enhance queue failed:", err))

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Blog publish error:", error)
    return NextResponse.json({ error: "Failed to publish post" }, { status: 500 })
  }
}
