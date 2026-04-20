// lib/social/resolve-media-url.ts
// Given a social_posts row's source_video_id + media_url, returns the best
// media URL to pass to the plugin.publish() call. Priority:
//   1. If source_video_id is set and the video exists in Firebase Storage,
//      generate a 1-hour signed READ URL.
//   2. Fall back to the post's media_url column (for manually-uploaded images).
//   3. Return null for text-only posts.

import { getVideoUploadById } from "@/lib/db/video-uploads"
import { getAdminStorage } from "@/lib/firebase-admin"

const SIGNED_URL_TTL_MS = 60 * 60 * 1000 // 1 hour — long enough for plugins to fetch

export interface ResolveMediaUrlInput {
  source_video_id: string | null
  media_url: string | null
}

export async function resolveMediaUrl(input: ResolveMediaUrlInput): Promise<string | null> {
  if (input.source_video_id) {
    try {
      const upload = await getVideoUploadById(input.source_video_id)
      if (upload?.storage_path) {
        const bucket = getAdminStorage().bucket()
        const file = bucket.file(upload.storage_path)
        const [url] = await file.getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        })
        return url
      }
    } catch {
      // Fall through to media_url fallback
    }
  }
  return input.media_url ?? null
}
