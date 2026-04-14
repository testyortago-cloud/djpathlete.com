import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost, deleteBlogPost, isSlugTaken } from "@/lib/db/blog-posts"
import { blogPostFormSchema } from "@/lib/validators/blog-post"
import { deleteBlogImage } from "@/lib/blog-storage"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const post = await getBlogPostById(id)
    return NextResponse.json(post)
  } catch (error) {
    console.error("Blog GET [id] error:", error)
    return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = blogPostFormSchema.partial().safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    if (parsed.data.slug) {
      const taken = await isSlugTaken(parsed.data.slug, id)
      if (taken) {
        return NextResponse.json({ error: "A post with this slug already exists" }, { status: 409 })
      }
    }

    const post = await updateBlogPost(id, parsed.data)
    return NextResponse.json(post)
  } catch (error) {
    console.error("Blog PATCH error:", error)
    return NextResponse.json({ error: "Failed to update blog post" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    // Clean up cover image if present
    try {
      const post = await getBlogPostById(id)
      if (post.cover_image_url) {
        const url = new URL(post.cover_image_url)
        const pathMatch = url.pathname.match(/blog-images\/(.+)$/)
        if (pathMatch) {
          await deleteBlogImage(pathMatch[1])
        }
      }
    } catch {
      // Image cleanup failure shouldn't block deletion
    }

    await deleteBlogPost(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Blog DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete blog post" }, { status: 500 })
  }
}
