// app/api/admin/social/posts/[id]/approve/route.ts
// POST — approves a social post. If the corresponding platform is connected,
// status flips to "approved" (ready for the scheduled publisher, Phase 3b).
// Otherwise status flips to "awaiting_connection" so Phase 2b OAuth can
// pick it up later.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { assertSourceVideoPostable } from "@/lib/content-studio/edit-gate"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const post = await getSocialPostById(id)
  if (!post) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  // Edit gate: approving readies a post for the publisher, so its source video
  // must clear the gate first (same chokepoint as the Content Studio status route).
  const guard = await assertSourceVideoPostable(post.source_video_id ?? null)
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: 409 })
  }

  const connections = await listPlatformConnections()
  const connected = new Set(connections.filter((c) => c.status === "connected").map((c) => c.plugin_name))

  const approvalStatus = connected.has(post.platform) ? "approved" : "awaiting_connection"
  const updated = await updateSocialPost(id, { approval_status: approvalStatus })

  return NextResponse.json({ id: updated.id, approval_status: updated.approval_status })
}
