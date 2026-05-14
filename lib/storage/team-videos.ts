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

/**
 * Path prefix for media-assets-owned images.
 *
 * Matches the existing Content Studio convention (see
 * app/api/admin/media-assets/upload-url/route.ts and
 * app/api/admin/content-studio/quote-cards/route.ts) which uses
 * `images/<scopeId>/<...>` in the default Firebase bucket. Team-submission
 * copies live under their submissionId for traceability rather than a userId.
 */
const MEDIA_ASSETS_PATH_PREFIX = "images"

/**
 * Copies a team-submission image into the media-assets path so the asset has
 * its own retention lifecycle separate from the editor pipeline. Returns the
 * new storage path and the `public_url` value the `media_assets` row should
 * store.
 *
 * Implementation: a server-side bucket-to-bucket copy within the default
 * Firebase bucket. The source object stays in `team-videos/` for the audit
 * trail.
 *
 * URL convention note: the existing media-assets flow (upload-url and
 * quote-cards routes) stores the **storage path** as `public_url`, not a
 * signed URL. Consumers sign it lazily via `lib/social/resolve-media-url.ts`
 * (for publishing) or `lib/content-studio/asset-thumbnails.ts` (for the asset
 * library). We mirror that so the downstream `media_assets` row behaves
 * identically to other Content Studio assets.
 */
export async function copyImageToMediaAssetsBucket(input: {
  sourceStoragePath: string
  submissionId: string
  position: number
  originalFilename: string
}): Promise<{ storagePath: string; publicUrl: string }> {
  const bucket = getAdminStorage().bucket()
  const safe = input.originalFilename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  const destPath = `${MEDIA_ASSETS_PATH_PREFIX}/${input.submissionId}/${input.position}_${safe}`
  await bucket.file(input.sourceStoragePath).copy(bucket.file(destPath))
  // `public_url` mirrors the storage path so it resolves through the same
  // lazy-signing pipeline as every other media asset in Content Studio.
  return { storagePath: destPath, publicUrl: destPath }
}
