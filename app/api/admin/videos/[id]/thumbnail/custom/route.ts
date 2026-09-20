// app/api/admin/videos/[id]/thumbnail/custom/route.ts
// POST — issue a signed upload URL for a CUSTOM thumbnail at a fresh path.
//
// Deliberately writes nothing. The sibling PUT .../thumbnail commits the row,
// but only after confirming the blob exists. The older POST .../thumbnail
// still writes ahead of the upload; that is correct for an auto-capture, where
// a failure costs a fallback icon, and wrong here, where it would destroy a
// thumbnail the operator had already set.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { customThumbnailUrlSchema, customThumbnailPath } from "@/lib/validators/video-thumbnail"

const UPLOAD_URL_EXPIRY_MS = 10 * 60 * 1000

export async function POST(
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
  const parsed = customThumbnailUrlSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const thumbnailPath = customThumbnailPath(video.storage_path, Date.now())
  const bucket = getAdminStorage().bucket()
  const [uploadUrl] = await bucket.file(thumbnailPath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType: parsed.data.contentType,
  })

  return NextResponse.json({
    uploadUrl,
    thumbnailPath,
    expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
  })
}
