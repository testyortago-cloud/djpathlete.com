// app/api/admin/blog/[id]/unschedule/route.ts
// POST — takes a scheduled post back to draft and clears its time.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getBlogPostById(id)
  if (post.status !== "scheduled") {
    return NextResponse.json({ error: "That post is not scheduled." }, { status: 409 })
  }

  const updated = await updateBlogPost(id, {
    status: "draft",
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  await recordAudit({
    action: "blog.schedule_cancelled",
    category: "marketing",
    target: { type: "blog_post", id },
    request,
  })

  return NextResponse.json({ id: updated.id, status: updated.status, scheduled_at: null })
}
