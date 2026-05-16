import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost, deleteBlogPost, isSlugTaken } from "@/lib/db/blog-posts"
import { blogPostFormSchema } from "@/lib/validators/blog-post"
import { deleteBlogImage } from "@/lib/blog-storage"
import { submitUrlToIndexNow } from "@/lib/indexnow"
import { withAudit } from "@/lib/audit/with-audit"

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

export const PATCH = withAudit(
  {
    action: "blog_post.updated",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "blog_post", id }
    },
  },
  async (request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
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

      // If the post is published, ping IndexNow so search engines re-crawl the
      // updated content. Fire-and-forget — never block the save on this.
      if (post.status === "published" && post.slug) {
        submitUrlToIndexNow(`/blog/${post.slug}`).catch((err) =>
          console.error("[Blog] IndexNow submit failed:", err),
        )
      }

      // Invalidate ISR caches so edits (including slug changes / unpublishing)
      // appear immediately on the marketing pages.
      revalidatePath("/blog")
      if (post.slug) revalidatePath(`/blog/${post.slug}`)

      return NextResponse.json(post)
    } catch (error) {
      console.error("Blog PATCH error:", error)
      return NextResponse.json({ error: "Failed to update blog post" }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  {
    action: "blog_post.deleted",
    category: "admin_write",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "blog_post", id }
    },
  },
  async (_request, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    try {
      const session = await auth()
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }

      const { id } = await params

      // Capture the slug before deletion so we can invalidate its detail page.
      let deletedSlug: string | null = null

      // Clean up cover image if present
      try {
        const post = await getBlogPostById(id)
        deletedSlug = post.slug ?? null
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

      // Drop the deleted post from /blog and its detail page immediately.
      revalidatePath("/blog")
      if (deletedSlug) revalidatePath(`/blog/${deletedSlug}`)

      return NextResponse.json({ success: true })
    } catch (error) {
      console.error("Blog DELETE error:", error)
      return NextResponse.json({ error: "Failed to delete blog post" }, { status: 500 })
    }
  },
)
