// app/api/admin/blog/[id]/schedule/route.ts
// POST { scheduled_at: ISO } — arms a post for automatic publishing.
// The contentScheduleCron picks it up when scheduled_at <= now.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBlogPostById, updateBlogPost } from "@/lib/db/blog-posts"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { validateScheduleRequest } from "@/lib/content-schedule/validate"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const validated = await validateScheduleRequest(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status })
  }

  const { id } = await params
  const post = await getBlogPostById(id)
  if (post.status === "published") {
    return NextResponse.json(
      { error: "This post is already live. Unpublish it first if you want to schedule it." },
      { status: 409 },
    )
  }

  const updated = await updateBlogPost(id, {
    status: "scheduled",
    scheduled_at: validated.scheduledAt.toISOString(),
    schedule_failed_reason: null,
  })

  await recordAudit({
    action: "blog.scheduled",
    category: "marketing",
    target: { type: "blog_post", id },
    request,
    metadata: { scheduled_at: validated.scheduledAt.toISOString() },
  })

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    scheduled_at: updated.scheduled_at,
  })
}
