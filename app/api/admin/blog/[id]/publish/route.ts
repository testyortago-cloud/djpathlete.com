import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { sendBlogNewsletterToAll } from "@/lib/email"

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

    // Send newsletter to all subscribers (fire-and-forget)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://djpathlete.com"

    sendBlogNewsletterToAll({
      title: updated.title,
      excerpt: updated.excerpt,
      url: `${baseUrl}/blog/${updated.slug}`,
      category: updated.category,
      coverImageUrl: updated.cover_image_url,
    }).catch((err) => console.error("[Blog] Newsletter send failed:", err))

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Blog publish error:", error)
    return NextResponse.json({ error: "Failed to publish post" }, { status: 500 })
  }
}
