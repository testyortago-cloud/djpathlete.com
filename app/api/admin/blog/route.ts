import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPosts, createBlogPost, isSlugTaken } from "@/lib/db/blog-posts"
import { blogPostFormSchema } from "@/lib/validators/blog-post"
import type { BlogPostStatus } from "@/types/database"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") as BlogPostStatus | null

    const posts = await getBlogPosts(status ?? undefined)
    return NextResponse.json(posts)
  } catch (error) {
    console.error("Blog GET error:", error)
    return NextResponse.json({ error: "Failed to fetch blog posts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = blogPostFormSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const data = parsed.data

    if (await isSlugTaken(data.slug)) {
      return NextResponse.json({ error: "A post with this slug already exists" }, { status: 409 })
    }

    const status = (body.status as BlogPostStatus) ?? "draft"

    const post = await createBlogPost({
      ...data,
      status,
      author_id: session.user.id,
      published_at: status === "published" ? new Date().toISOString() : null,
    })

    return NextResponse.json(post, { status: 201 })
  } catch (error) {
    console.error("Blog POST error:", error)
    return NextResponse.json({ error: "Failed to create blog post" }, { status: 500 })
  }
}
