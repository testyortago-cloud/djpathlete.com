// app/api/admin/social/posts/[id]/unschedule/route.ts
// POST — takes a scheduled post back to "approved" and clears scheduled_at.
// Intended for "oops, I don't want this to go out at that time anymore" —
// the post stays approved so the coach can pick a new time later via the
// schedule picker, without losing the approval work.
//
// If the row had a native-platform schedule (platform_post_id set, e.g. a
// Facebook scheduled post sitting in Meta Business Suite's queue), we also
// delete it on the platform so it doesn't ship at the original time.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"

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
  if (post.approval_status !== "scheduled") {
    return NextResponse.json(
      { error: `Only scheduled posts can be unscheduled (current status: ${post.approval_status})` },
      { status: 409 },
    )
  }

  // If this row was scheduled natively on the platform, cancel it there
  // first. Failure to cancel is a hard error — we don't clear our DB record
  // because that would leave a ghost post that publishes at the original
  // scheduled time with no way for the coach to find or stop it.
  if (post.platform_post_id) {
    const connections = await listPlatformConnections()
    bootstrapPlugins(connections)
    const plugin = pluginRegistry.get(post.platform)
    if (plugin?.unscheduleOnPlatform) {
      const result = await plugin.unscheduleOnPlatform(post.platform_post_id)
      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? "Failed to cancel scheduled post on platform" },
          { status: 502 },
        )
      }
    }
  }

  const updated = await updateSocialPost(id, {
    approval_status: "approved",
    scheduled_at: null,
    platform_post_id: null,
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
