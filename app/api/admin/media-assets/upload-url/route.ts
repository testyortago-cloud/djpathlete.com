import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAdminStorage } from "@/lib/firebase-admin"
import { createMediaAsset } from "@/lib/db/media-assets"
import { mediaAssetUploadUrlSchema } from "@/lib/validators/media-asset"
import { createAiJob } from "@/lib/ai-jobs"

const UPLOAD_URL_EXPIRY_MS = 15 * 60 * 1000

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = mediaAssetUploadUrlSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const { filename, contentType } = parsed.data
  const safeFilename = sanitizeFilename(filename)
  const storagePath = `images/${session.user.id}/${Date.now()}-${safeFilename}`

  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType,
  })

  const asset = await createMediaAsset({
    kind: "image",
    storage_path: storagePath,
    public_url: storagePath,
    mime_type: contentType,
    bytes: 0,
    width: null,
    height: null,
    duration_ms: null,
    derived_from_video_id: null,
    ai_alt_text: null,
    ai_analysis: null,
    created_by: session.user.id,
  })

  // Fire-and-forget: kick off vision AI alt-text. Failure must not block the
  // upload response — the asset row is fine without ai metadata and a later
  // manual "regenerate" could populate it.
  try {
    await createAiJob({
      type: "image_vision",
      userId: session.user.id,
      input: { mediaAssetId: asset.id },
    })
  } catch (err) {
    console.error("[upload-url] failed to enqueue image_vision job", err)
  }

  return NextResponse.json(
    {
      mediaAssetId: asset.id,
      uploadUrl,
      storagePath,
      expiresInSeconds: Math.floor(UPLOAD_URL_EXPIRY_MS / 1000),
    },
    { status: 201 },
  )
}
