import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import type { VideoUpload } from "@/types/database"

export interface PipelineData {
  videos: VideoUpload[]
  posts: PipelinePostRow[]
  postCountsByVideo: Record<string, PostCounts>
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

  return { videos, posts, postCountsByVideo }
}
