// app/api/admin/videos/route.ts
// POST { filename, contentType?, title? } — creates a video_uploads row and
// returns a Firebase Storage signed upload URL so the client can PUT the
// bytes directly to Storage (saves Vercel bandwidth and avoids the 5 MB body
// limit on Vercel serverless).

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { createVideoUpload } from "@/lib/db/video-uploads"

const UPLOAD_URL_EXPIRY_MS = 15 * 60 * 1000 // 15 minutes

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { filename?: string; contentType?: string; title?: string }
    | null

  const filename = body?.filename?.trim()
  if (!filename) {
    return NextResponse.json({ error: "filename is required" }, { status: 400 })
  }

  const contentType = body?.contentType ?? "video/mp4"
  const safeFilename = sanitizeFilename(filename)
  const storagePath = `videos/${session.user.id}/${Date.now()}-${safeFilename}`

  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType,
  })

  const upload = await createVideoUpload({
    storage_path: storagePath,
    original_filename: filename,
    mime_type: contentType,
    duration_seconds: null,
    size_bytes: null,
    title: body?.title ?? null,
    uploaded_by: session.user.id,
    status: "uploaded",
  })

  return NextResponse.json(
    {
      videoUploadId: upload.id,
      uploadUrl,
      storagePath,
      expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
    },
    { status: 201 },
  )
}
