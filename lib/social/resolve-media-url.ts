// lib/social/resolve-media-url.ts
// Given a social_posts row's source_video_id + media_url, returns the best
// media URL to pass to the plugin.publish() call. Priority:
//   1. If source_video_id is set and the video exists in Firebase Storage,
//      generate a 1-hour signed READ URL.
//   2. If media_url is set:
//        a) if it looks like an http(s) URL, return it verbatim
//        b) otherwise treat it as a Firebase storage path and sign it
//      (b) covers image posts where the mirror trigger copied media_assets.public_url
//      (which stores the Firebase path, not a real URL) into social_posts.media_url.
//   3. Return null for text-only posts.

import sharp from "sharp"
import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getAdminStorage } from "@/lib/firebase-admin"
import { autoThumbnailPath } from "@/lib/validators/video-thumbnail"

const SIGNED_URL_TTL_MS = 60 * 60 * 1000
/** Instagram's cover_url: JPEG, 8 MB at most. */
const COVER_MAX_BYTES = 8 * 1024 * 1024
const HTTP_URL = /^https?:\/\//i

export interface ResolveMediaUrlInput {
  source_video_id: string | null
  media_url: string | null
}

async function signStoragePath(path: string): Promise<string | null> {
  try {
    const bucket = getAdminStorage().bucket()
    const file = bucket.file(path)
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    })
    return url
  } catch {
    return null
  }
}

export async function resolveMediaUrl(input: ResolveMediaUrlInput): Promise<string | null> {
  if (input.source_video_id) {
    const upload = await getVideoUploadById(input.source_video_id).catch(() => null)
    if (upload?.storage_path) {
      const url = await signStoragePath(upload.storage_path)
      if (url) return url
    }
  }

  if (input.media_url) {
    if (HTTP_URL.test(input.media_url)) return input.media_url
    return await signStoragePath(input.media_url)
  }

  return null
}

/**
 * Signed JPEG URL of the thumbnail the operator chose for a video, or null when
 * they chose none (the auto capture is just the opening frame, which the
 * platform uses anyway). A custom path always ends `.jpg` but an uploaded one
 * may hold PNG/WebP bytes, so anything else is converted once to
 * `<path>.cover.jpg` and reused. Never throws: a missing cover must not stop
 * the post itself from publishing.
 */
export async function resolveCoverUrl(sourceVideoId: string | null): Promise<string | null> {
  if (!sourceVideoId) return null
  try {
    const upload = await getVideoUploadById(sourceVideoId)
    const path = upload?.thumbnail_path
    if (!upload || !path || path === autoThumbnailPath(upload.storage_path)) return null
    return await signedJpegCopy(path, ".cover.jpg")
  } catch (err) {
    console.warn(`[resolveCoverUrl] video ${sourceVideoId}: no cover sent`, err)
    return null
  }
}

/**
 * Signed JPEG URL for a story photo. Instagram documents JPEG for story
 * images, and a phone photo or quote card may be PNG or WebP, so anything else
 * is converted once to `<path>.story.jpg` and reused. Null when the file is gone.
 */
export async function resolveStoryImageUrl(path: string): Promise<string | null> {
  try {
    return await signedJpegCopy(path, ".story.jpg")
  } catch (err) {
    console.warn(`[resolveStoryImageUrl] ${path}: could not read the photo`, err)
    return null
  }
}

/** Sign `path` if it is already a JPEG within 8 MB; otherwise convert it once to `<path><suffix>` and sign that. */
async function signedJpegCopy(path: string, suffix: string): Promise<string | null> {
  const bucket = getAdminStorage().bucket()
  const [meta] = await bucket.file(path).getMetadata()
  if (meta.contentType === "image/jpeg" && Number(meta.size) <= COVER_MAX_BYTES) return signStoragePath(path)

  const copyPath = `${path}${suffix}`
  const [converted] = await bucket.file(copyPath).exists()
  if (!converted) {
    const [bytes] = await bucket.file(path).download()
    // .rotate() with no angle applies the EXIF orientation: a phone photo is often
    // stored sideways with a tag saying so, and the tag is dropped on re-encode.
    const jpeg = await sharp(bytes)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
    await bucket.file(copyPath).save(jpeg, { contentType: "image/jpeg" })
  }
  return signStoragePath(copyPath)
}
