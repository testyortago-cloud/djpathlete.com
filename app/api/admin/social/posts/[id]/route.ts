// app/api/admin/social/posts/[id]/route.ts
// PATCH { caption_text, hashtags } — edits the latest caption for a post.
// Writes a new social_captions row with version = latest + 1, and updates
// social_posts.content to match. Leaves approval_status alone (the coach
// approves explicitly after editing).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSocialPostById, updateSocialPost } from "@/lib/db/social-posts"
import { addCaptionToPost, listCaptionsForPost } from "@/lib/db/social-captions"

export async function PATCH(
  request: NextRequest,
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

  const body = (await request.json().catch(() => null)) as
    | { caption_text?: string; hashtags?: string[] }
    | null
  const caption_text = body?.caption_text?.trim()
  if (!caption_text) {
    return NextResponse.json({ error: "caption_text is required" }, { status: 400 })
  }
  const hashtags = Array.isArray(body?.hashtags) ? body!.hashtags.map((h) => h.trim()).filter(Boolean) : []

  const existingCaptions = await listCaptionsForPost(id)
  const nextVersion = existingCaptions.reduce((max, c) => Math.max(max, c.version), 0) + 1

  await addCaptionToPost({
    social_post_id: id,
    caption_text,
    hashtags,
    version: nextVersion,
  })

  const updated = await updateSocialPost(id, {
    content: caption_text,
    approval_status: post.approval_status === "draft" ? "edited" : post.approval_status,
  })

  return NextResponse.json({
    id: updated.id,
    content: updated.content,
    approval_status: updated.approval_status,
    version: nextVersion,
  })
}
