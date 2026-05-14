import { getAdminStorage } from "@/lib/firebase-admin"
import {
  TEAM_VIDEO_PATH_PREFIX,
  TEAM_VIDEO_UPLOAD_URL_TTL_MS,
  TEAM_VIDEO_READ_URL_TTL_MS,
} from "./team-videos-config"

/** Build the storage path for a version: team-videos/<submissionId>/v<n>/<safeFilename> */
export function buildVersionPath(
  submissionId: string,
  versionNumber: number,
  filename: string,
): string {
  // Sanitize: alphanumerics, dot, dash, underscore. Cap at 120 chars to mirror
  // the convention in app/api/admin/videos/route.ts:sanitizeFilename.
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  return `${TEAM_VIDEO_PATH_PREFIX}/${submissionId}/v${versionNumber}/${safe}`
}

/** Build the storage path for one image in an image_set version. */
export function buildImagePath(
  submissionId: string,
  versionNumber: number,
  position: number,
  filename: string,
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  return `${TEAM_VIDEO_PATH_PREFIX}/${submissionId}/v${versionNumber}/${position}_${safe}`
}

export interface ImageUploadSpec {
  storagePath: string
  contentType: string
}

export interface SignedImageUpload {
  storagePath: string
  uploadUrl: string
  expiresInSeconds: number
}

/**
 * Create N parallel Firebase v4 signed PUT URLs, one per image. Each upload is
 * independently signed; callers fire them in parallel from the browser.
 */
export async function createImageUploadUrls(
  images: ImageUploadSpec[],
): Promise<SignedImageUpload[]> {
  const bucket = getAdminStorage().bucket()
  return Promise.all(
    images.map(async (img) => {
      const file = bucket.file(img.storagePath)
      const [uploadUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + TEAM_VIDEO_UPLOAD_URL_TTL_MS,
        contentType: img.contentType,
      })
      return {
        storagePath: img.storagePath,
        uploadUrl,
        expiresInSeconds: Math.floor(TEAM_VIDEO_UPLOAD_URL_TTL_MS / 1000),
      }
    }),
  )
}

/**
 * Confirms a file exists in the team-videos bucket. Used by finalize to verify
 * every image actually got PUT before flipping submission status.
 */
export async function imageStorageObjectExists(storagePath: string): Promise<boolean> {
  const bucket = getAdminStorage().bucket()
  const [exists] = await bucket.file(storagePath).exists()
  return exists
}

/**
 * Create a Firebase v4 signed URL the editor's browser can PUT to directly.
 * Returns just the URL + the path we built — Firebase's v4 signed URLs are
 * self-contained (no separate token needed, unlike Supabase Storage).
 */
export async function createUploadUrl(input: {
  storagePath: string
  contentType: string
}): Promise<{ uploadUrl: string; storagePath: string; expiresInSeconds: number }> {
  const bucket = getAdminStorage().bucket()
  const file = bucket.file(input.storagePath)
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + TEAM_VIDEO_UPLOAD_URL_TTL_MS,
    contentType: input.contentType,
  })
  return {
    uploadUrl,
    storagePath: input.storagePath,
    expiresInSeconds: Math.floor(TEAM_VIDEO_UPLOAD_URL_TTL_MS / 1000),
  }
}

/**
 * Create a v4 signed read URL for streaming the video back to the browser.
 * Used by VideoPlayer. Expires after TEAM_VIDEO_READ_URL_TTL_MS by default.
 */
export async function createReadUrl(
  storagePath: string,
  expiresInMs = TEAM_VIDEO_READ_URL_TTL_MS,
): Promise<string> {
  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMs,
  })
  return url
}

/**
 * Create a v4 signed read URL that forces the browser to download the file
 * (instead of streaming it inline) by setting Content-Disposition: attachment
 * via the responseDisposition query param. Use for the "Download" buttons.
 */
export async function createDownloadUrl(
  storagePath: string,
  filename: string,
  expiresInMs = TEAM_VIDEO_READ_URL_TTL_MS,
): Promise<string> {
  const bucket = getAdminStorage().bucket()
  const file = bucket.file(storagePath)
  // Quote/escape the filename so semicolons or quotes don't break the header.
  const safe = filename.replace(/[\\"]/g, "_")
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMs,
    responseDisposition: `attachment; filename="${safe}"`,
  })
  return url
}

/**
 * Delete a video from storage. Used rarely — versioning normally keeps history,
 * but ON DELETE CASCADE on team_video_versions will leave Firebase orphans
 * that can be cleaned up out-of-band if needed.
 */
export async function deleteVideo(storagePath: string): Promise<void> {
  const bucket = getAdminStorage().bucket()
  await bucket.file(storagePath).delete({ ignoreNotFound: true })
}
