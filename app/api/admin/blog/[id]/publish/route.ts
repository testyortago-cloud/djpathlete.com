import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { publishBlogPost } from "@/lib/blog/publish-post"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    await publishBlogPost({ id, actorId: session.user.id })
    return NextResponse.json(await getBlogPostById(id))
  } catch (error) {
    console.error("Blog publish error:", error)
    return NextResponse.json({ error: "Failed to publish post" }, { status: 500 })
  }
}
