// app/api/admin/videos/[id]/route.ts
// GET  — returns the video row + a short-lived signed GET URL for inline preview.
// DELETE — removes the Firebase Storage blob and the Supabase row. Admin-only.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById, deleteVideoUpload } from "@/lib/db/video-uploads"
import { getTranscriptForVideo } from "@/lib/db/video-transcripts"

const PREVIEW_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const video = await getVideoUploadById(id)
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 })
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
  // (see migration 00079). Other FK references (social_posts, blog_posts) are
  // ON DELETE SET NULL so they just detach.
  await deleteVideoUpload(id)

  return NextResponse.json({ ok: true })
}
