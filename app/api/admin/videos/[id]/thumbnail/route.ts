// app/api/admin/videos/[id]/thumbnail/route.ts
// POST — issues a Firebase Storage signed upload URL for a video thumbnail,
// and writes the storage path onto the video_uploads row so later queries can
// sign a read URL for display.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById, updateVideoUpload } from "@/lib/db/video-uploads"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  commitThumbnailSchema,
  autoThumbnailPath,
  isLegalCustomThumbnailPath,
} from "@/lib/validators/video-thumbnail"

const UPLOAD_URL_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

export async function POST(
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

/**
 * PUT — point the row at a thumbnail that is ALREADY in the bucket.
 *
 * Two things this must never do:
 *  - write a path the client chose without checking it belongs to this video
 *    (otherwise a row can be pointed at any blob in the bucket);
 *  - write a path whose blob is not there. A signed-URL PUT that did not throw
 *    is not proof the bytes landed, so we ask the bucket rather than the client.
 */
export async function PUT(
  request: NextRequest,
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

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = commitThumbnailSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const targetPath =
    parsed.data.source === "auto"
      ? autoThumbnailPath(video.storage_path)
      : parsed.data.thumbnailPath

  if (
    parsed.data.source !== "auto" &&
    !isLegalCustomThumbnailPath(video.storage_path, targetPath)
  ) {
    return NextResponse.json({ error: "thumbnailPath does not belong to this video" }, { status: 400 })
  }

  const bucket = getAdminStorage().bucket()
  const [exists] = await bucket.file(targetPath).exists()
  if (!exists) {
    return NextResponse.json(
      {
        error:
          parsed.data.source === "auto"
            ? "The original auto thumbnail is no longer available"
            : "Thumbnail was not uploaded",
      },
      { status: 409 },
    )
  }

  await updateVideoUpload(id, {
    thumbnail_path: targetPath,
    thumbnail_source: parsed.data.source,
  })

  return NextResponse.json({ thumbnailPath: targetPath, thumbnailSource: parsed.data.source })
}
