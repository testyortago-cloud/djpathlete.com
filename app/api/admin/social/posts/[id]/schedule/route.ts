// app/api/admin/social/posts/[id]/schedule/route.ts
// POST { scheduled_at: ISO datetime } — schedules an approved post for
// automatic publishing. Vercel Cron's /publish-due handler picks up rows
// where approval_status="scheduled" AND scheduled_at <= now().

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { scheduled_at?: string } | null
  const scheduledAtRaw = body?.scheduled_at?.trim()
  if (!scheduledAtRaw) {
    return NextResponse.json({ error: "scheduled_at is required (ISO datetime string)" }, { status: 400 })
  }

  const scheduledAt = new Date(scheduledAtRaw)
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "scheduled_at is not a valid datetime" }, { status: 400 })
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }
  if (post.approval_status !== "approved" && post.approval_status !== "scheduled") {
    return NextResponse.json(
      { error: `Only approved posts can be scheduled (current status: ${post.approval_status})` },
      { status: 409 },
    )
  }

  const updated = await updateSocialPost(id, {
    approval_status: "scheduled",
    scheduled_at: scheduledAt.toISOString(),
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
