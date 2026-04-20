// app/api/admin/social/posts/[id]/reject/route.ts
// POST { rejection_notes } — rejects a social post. Notes are stored on the
// post row and are fed back into future generation as negative examples
// (Phase 5 performance-learning loop).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateSocialPost, getSocialPostById } from "@/lib/db/social-posts"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await getSocialPostById(id)
  if (!existing) {
    return NextResponse.json({ error: "Social post not found" }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { rejection_notes?: string } | null
  const notes = body?.rejection_notes?.trim() ?? null

  const updated = await updateSocialPost(id, {
    approval_status: "rejected",
    rejection_notes: notes,
  })

  return NextResponse.json({ id: updated.id, approval_status: updated.approval_status })
}
