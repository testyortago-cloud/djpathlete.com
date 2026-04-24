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

import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getAdminStorage } from "@/lib/firebase-admin"

const SIGNED_URL_TTL_MS = 60 * 60 * 1000
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
