// app/api/admin/social/posts/[id]/schedule/route.ts
// POST { scheduled_at: ISO datetime } — schedules a post for automatic
// publishing. Auto-approves the post first if needed, so the coach only has
// to answer "when?" instead of stepping through a draft → approved → scheduled
// state machine. Vercel Cron's /publish-due handler picks up rows where
// approval_status="scheduled" AND scheduled_at <= now().

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"

const SCHEDULABLE_STATUSES = new Set([
  "draft",
  "edited",
  "approved",
  "scheduled",
  "awaiting_connection",
  "failed",
])

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

  if (!SCHEDULABLE_STATUSES.has(post.approval_status)) {
    return NextResponse.json(
      { error: `Cannot schedule a ${post.approval_status} post` },
      { status: 409 },
    )
  }

  const connections = await listPlatformConnections()
  const connected = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.plugin_name),
  )
  if (!connected.has(post.platform)) {
    return NextResponse.json(
      { error: `Connect ${post.platform} first to schedule this post` },
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
