import { getAdminStorage } from "@/lib/firebase-admin"
import { MAX_ATTACHMENT_BYTES, READ_URL_TTL_MS, UPLOAD_URL_TTL_MS } from "./config"
import { kindForMime } from "./attachments"

/**
 * Firebase v4 signed PUT URL the browser uploads to directly, so 25 MB of video
 * never passes through a Vercel function. Mirrors lib/storage/team-videos.ts.
 */
export async function createAttachmentUploadUrl(input: {
  storagePath: string
  contentType: string
}): Promise<{ uploadUrl: string; storagePath: string; expiresInSeconds: number }> {
  const bucket = getAdminStorage().bucket()
  const [uploadUrl] = await bucket.file(input.storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType: input.contentType,
  })
  return {
    uploadUrl,
    storagePath: input.storagePath,
    expiresInSeconds: Math.floor(UPLOAD_URL_TTL_MS / 1000),
  }
}

export type VerifyResult =
  | { ok: true; size: number; contentType: string }
  | { ok: false; reason: "missing" | "too_large" | "wrong_type" }

/**
 * Check what was ACTUALLY uploaded.
 *
 * A signed PUT URL constrains Content-Type but NOT length — a client that lies
 * about byte_size in the sign request can still upload a gigabyte. The declared
 * size is a courtesy check; this is the control.
 */
export async function verifyUploadedObject(storagePath: string): Promise<VerifyResult> {
  const file = getAdminStorage().bucket().file(storagePath)

  const [exists] = await file.exists()
  if (!exists) return { ok: false, reason: "missing" }

  const [metadata] = await file.getMetadata()
  const size = Number(metadata.size ?? 0)
  const contentType = String(metadata.contentType ?? "")

  if (!kindForMime(contentType)) return { ok: false, reason: "wrong_type" }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "too_large" }
  }
  return { ok: true, size, contentType }
}

/**
 * A fresh signed read URL, re-issued on every request.
 *
 * Never store the result as a durable href: signed GCS URLs expire, and a thread
 * people scroll back through for weeks would fill with ExpiredToken images. The
 * attachment route 302s to this instead.
 */
export async function createAttachmentReadUrl(storagePath: string, ttlMs = READ_URL_TTL_MS): Promise<string> {
  const [url] = await getAdminStorage()
    .bucket()
    .file(storagePath)
    .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + ttlMs })
  return url
}

/** Used on every failure path after bytes are stored, so nothing is orphaned. */
export async function deleteAttachmentObject(storagePath: string): Promise<void> {
  await getAdminStorage().bucket().file(storagePath).delete({ ignoreNotFound: true })
}
