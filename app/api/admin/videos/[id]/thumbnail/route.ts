// app/api/admin/videos/[id]/thumbnail/route.ts
// POST — issues a Firebase Storage signed upload URL for a video thumbnail,
// and writes the storage path onto the video_uploads row so later queries can
// sign a read URL for display.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById, updateVideoUpload } from "@/lib/db/video-uploads"

const UPLOAD_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export async function POST(
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

  // Store the thumbnail next to the video: {path}.thumb.jpg
  const thumbnailPath = `${video.storage_path}.thumb.jpg`

  const bucket = getAdminStorage().bucket()
  const [uploadUrl] = await bucket.file(thumbnailPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType: "image/jpeg",
  })

  // Persist the path now. If the client PUT fails the row still points at
  // a non-existent blob — the card renderer falls back to the Film icon in
  // that case, so this is safe.
  await updateVideoUpload(id, { thumbnail_path: thumbnailPath })

  return NextResponse.json({
    uploadUrl,
    thumbnailPath,
    expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
  })
}
