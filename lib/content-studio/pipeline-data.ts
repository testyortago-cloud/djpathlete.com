import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import { getAdminStorage } from "@/lib/firebase-admin"
import type { VideoUpload } from "@/types/database"

const THUMBNAIL_URL_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes

export interface PipelineData {
  videos: VideoUpload[]
  posts: PipelinePostRow[]
  postCountsByVideo: Record<string, PostCounts>
  /** Signed read URL per video-id, only for videos that have a thumbnail_path. */
  thumbnailUrlsByVideo: Record<string, string>
}

export interface PostCounts {
  total: number
  approved: number
  scheduled: number
  published: number
  failed: number
  needs_review: number
}

function emptyCounts(): PostCounts {
  return { total: 0, approved: 0, scheduled: 0, published: 0, failed: 0, needs_review: 0 }
}

async function signThumbnailUrls(
  videos: VideoUpload[],
): Promise<Record<string, string>> {
  const bucket = getAdminStorage().bucket()
  const entries = await Promise.all(
    videos
      .filter((v) => v.thumbnail_path)
      .map(async (v) => {
        try {
          const [url] = await bucket.file(v.thumbnail_path!).getSignedUrl({
            version: "v4",
            action: "read",
            expires: Date.now() + THUMBNAIL_URL_EXPIRY_MS,
          })
          return [v.id, url] as const
        } catch {
          // Blob may be missing if upload failed mid-flight — just skip.
          return null
        }
      }),
  )
  const out: Record<string, string> = {}
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1]
  }
  return out
}

export async function getPipelineData(): Promise<PipelineData> {
  const [videos, posts] = await Promise.all([
    listVideoUploads({ limit: 200 }),
    listSocialPostsForPipeline(),
  ])

  const postCountsByVideo: Record<string, PostCounts> = {}
  for (const p of posts) {
    if (!p.source_video_id) continue
    const counts = (postCountsByVideo[p.source_video_id] ??= emptyCounts())
    counts.total += 1
    switch (p.approval_status) {
      case "approved":
      case "awaiting_connection":
        counts.approved += 1
        break
      case "scheduled":
        counts.scheduled += 1
        break
      case "published":
        counts.published += 1
        break
      case "failed":
        counts.failed += 1
        break
      case "draft":
      case "edited":
        counts.needs_review += 1
        break
    }
  }

  const thumbnailUrlsByVideo = await signThumbnailUrls(videos)

  return { videos, posts, postCountsByVideo, thumbnailUrlsByVideo }
}
