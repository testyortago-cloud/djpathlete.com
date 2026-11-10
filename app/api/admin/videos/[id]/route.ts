// app/api/admin/videos/[id]/route.ts
// GET    — returns the video row + a short-lived signed GET URL for inline preview.
// PATCH  — { needs_edit: boolean } manual override for the edit gate (Mark as ready).
// DELETE — removes the Firebase Storage blob and the Supabase row. Admin-only.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import {
  getVideoUploadById,
  deleteVideoUpload,
  updateVideoUpload,
} from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"
import { deleteSocialPost, listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const PREVIEW_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const video = await getVideoUploadById(id)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  const bucket = getAdminStorage().bucket()
  const file = bucket.file(video.storage_path)
  const [previewUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + PREVIEW_URL_EXPIRY_MS,
  })

  // Attach transcript when available — admin UI surfaces it inline from this response.
  const transcript = await getTranscriptForVideo(id)

  return NextResponse.json({
    video,
    previewUrl,
    expiresInSeconds: Math.floor(PREVIEW_URL_EXPIRY_MS / 1000),
    transcript: transcript
      ? {
          id: transcript.id,
          text: transcript.transcript_text,
          source: transcript.source,
          created_at: transcript.created_at,
        }
      : null,
  })
}

// PATCH  — { needs_edit?: boolean; hook_text?: string|null } — edit-gate override (Mark ready) + reel hook.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { needs_edit?: boolean; hook_text?: string | null }
    | null

  const patch: { needs_edit?: boolean; hook_text?: string | null } = {}
  if (typeof body?.needs_edit === "boolean") patch.needs_edit = body.needs_edit
  if (typeof body?.hook_text === "string" || body?.hook_text === null) {
    // Trim + cap to the 80-char hook limit; empty → null (clears the card).
    const trimmed = typeof body.hook_text === "string" ? body.hook_text.trim().slice(0, 80) : ""
    patch.hook_text = trimmed.length > 0 ? trimmed : null
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "needs_edit (boolean) or hook_text (string|null) is required" }, { status: 400 })
  }

  const { id } = await params
  const updated = await updateVideoUpload(id, patch)
  return NextResponse.json({ id: updated.id, needs_edit: updated.needs_edit, hook_text: updated.hook_text ?? null })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const video = await getVideoUploadById(id)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
  }

  // The video's posts. Left alone, social_posts.source_video_id is SET NULL and a
  // scheduled post still fires with no video (Facebook posts the bare caption).
  // So every post that has not gone out goes with the video; published ones stay
  // as the record of what went live (deleting them here would not remove them
  // from Instagram or Facebook anyway).
  const posts = await listSocialPostsBySourceVideo(id)
  const nativelyScheduled = posts.filter((p) => p.approval_status === "scheduled" && p.platform_post_id)
  if (nativelyScheduled.length > 0) {
    return NextResponse.json(
      {
        error:
          "A post from this video is waiting in Facebook's own schedule. Open it in the Posts list and press " +
          '"Unschedule" first, then delete the video.',
      },
      { status: 409 },
    )
  }
  const unsent = posts.filter((p) => p.approval_status !== "published")
  try {
    for (const p of unsent) await deleteSocialPost(p.id)
  } catch (err) {
    console.error("[videos/delete] post delete failed:", err)
    return NextResponse.json(
      { error: "Could not remove this video's posts, so the video was kept. Try again." },
      { status: 500 },
    )
  }

  // Delete the storage blob first — if the row exists but the blob is gone,
  // a second DELETE attempt should still succeed cleaning up the row.
  const bucket = getAdminStorage().bucket()
  try {
    await bucket.file(video.storage_path).delete({ ignoreNotFound: true })
  } catch (err) {
    console.error("[videos/delete] Storage blob delete failed:", err)
    // Continue — row cleanup still valuable even if blob can't be removed.
  }

  // ON DELETE CASCADE on video_transcripts handles transcript rows automatically
  // (see migration 00079). The published posts kept above, and blog_posts, are
  // ON DELETE SET NULL so they just detach.
  await deleteVideoUpload(id)

  return NextResponse.json({ ok: true, deletedPosts: unsent.length, keptPublished: posts.length - unsent.length })
}
