// app/api/admin/social/posts/[id]/publish-now/route.ts
// POST — queues a post for the next publish cycle (≤5 min) by setting
// scheduled_at to a past timestamp. Auto-approves drafts so the coach
// can publish in one click; checks platform connection so we don't queue
// a post we can't actually deliver. Stories follow a lightweight pipeline
// where draft posts are always allowed (umbrella spec §5.6).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"

const PUBLISHABLE_STATUSES = new Set([
  "draft",
  "edited",
  "approved",
  "scheduled",
  "awaiting_connection",
  "failed",
])

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  if (!PUBLISHABLE_STATUSES.has(post.approval_status)) {
    return NextResponse.json(
      { error: `Cannot publish a ${post.approval_status} post` },
      { status: 409 },
    )
  }

  // Stories skip the platform-connection check because the lightweight
  // story pipeline (draft → published) is exempt from the connection gate.
  if (post.post_type !== "story") {
    const connections = await listPlatformConnections()
    const connected = new Set(
      connections.filter((c) => c.status === "connected").map((c) => c.plugin_name),
    )
    if (!connected.has(post.platform)) {
      return NextResponse.json(
        { error: `Connect ${post.platform} first to publish this post` },
        { status: 409 },
      )
    }
  }

  const scheduledAt = new Date(Date.now() - 1000).toISOString()

  const updated = await updateSocialPost(id, {
    approval_status: "scheduled",
    scheduled_at: scheduledAt,
    rejection_notes: null,
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
