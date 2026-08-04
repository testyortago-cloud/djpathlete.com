// POST /api/messaging/attachments/upload-url
// Signs one Firebase v4 PUT URL per file so the browser uploads directly.
//
// The declared byte_size is checked here as a cheap early rejection. It is NOT
// the control -- a signed URL constrains Content-Type but not length, so the
// send route re-checks the object's real size before storing a row.
import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { resolveParticipant } from "@/lib/messaging/access"
import { buildStoragePath, validateAttachmentSpecs } from "@/lib/messaging/attachments"
import { createAttachmentUploadUrl } from "@/lib/messaging/storage"
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/messaging/config"

export const runtime = "nodejs"

const schema = z.object({
  conversation_id: z.string().uuid(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        mime_type: z.string().min(1),
        byte_size: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(MAX_ATTACHMENTS_PER_MESSAGE),
})

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const participant = await resolveParticipant(session, parsed.data.conversation_id)
  if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const validation = validateAttachmentSpecs(parsed.data.files)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const uploads = await Promise.all(
    parsed.data.files.map(async (file) => {
      const uploadId = randomUUID()
      const storagePath = buildStoragePath(parsed.data.conversation_id, uploadId, file.filename)
      const signed = await createAttachmentUploadUrl({ storagePath, contentType: file.mime_type })
      return {
        upload_id: uploadId,
        storage_path: signed.storagePath,
        upload_url: signed.uploadUrl,
        expires_in_seconds: signed.expiresInSeconds,
      }
    }),
  )

  return NextResponse.json({ uploads })
}
