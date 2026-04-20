// app/api/admin/social/posts/[id]/unschedule/route.ts
// POST — takes a scheduled post back to "approved" and clears scheduled_at.
// Intended for "oops, I don't want this to go out at that time anymore" —
// the post stays approved so the coach can pick a new time later via the
// schedule picker, without losing the approval work.

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
  if (post.approval_status !== "scheduled") {
    return NextResponse.json(
      { error: `Only scheduled posts can be unscheduled (current status: ${post.approval_status})` },
      { status: 409 },
    )
  }

  const updated = await updateSocialPost(id, {
    approval_status: "approved",
    scheduled_at: null,
  })

  return NextResponse.json({
    id: updated.id,
    approval_status: updated.approval_status,
    scheduled_at: updated.scheduled_at,
  })
}
