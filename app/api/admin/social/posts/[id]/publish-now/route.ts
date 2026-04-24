// app/api/admin/social/posts/[id]/publish-now/route.ts
// POST — transitions approved OR failed posts into "scheduled" with
// scheduled_at set to a past timestamp, so the publish-due cron picks it
// up on the next cycle (≤5 min). Also clears rejection_notes so any stale
// failure reason disappears from the UI.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"

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

  // Stories follow a lightweight pipeline (umbrella spec §5.6) — draft → published
  // skipping the approved gate. Non-story posts still require approval first.
  const isStoryDraftBypass =
    post.approval_status === "draft" && post.post_type === "story"
  const allowed =
    post.approval_status === "approved" ||
    post.approval_status === "failed" ||
    isStoryDraftBypass
  if (!allowed) {
    return NextResponse.json(
      {
        error: `Publish Now only works for approved, failed, or draft-Story posts (current status: ${post.approval_status})`,
      },
      { status: 409 },
    )
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
