import type { SocialPost, VideoUpload } from "@/types/database"

export const VIDEO_COLUMNS = ["uploaded", "transcribing", "transcribed", "generated", "complete"] as const
export type VideoColumn = (typeof VIDEO_COLUMNS)[number]

export const VIDEO_COLUMN_LABELS: Record<VideoColumn, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  generated: "Generated",
  complete: "Complete",
}

export const POST_COLUMNS = ["needs_review", "approved", "scheduled", "published", "failed"] as const
export type PostColumn = (typeof POST_COLUMNS)[number]

export const POST_COLUMN_LABELS: Record<PostColumn, string> = {
  needs_review: "Needs Review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
}

export function videoColumnFor(video: VideoUpload, posts: SocialPost[]): VideoColumn {
  const myPosts = posts.filter((p) => p.source_video_id === video.id)
  if (myPosts.length > 0) {
    const allPublished = myPosts.every((p) => p.approval_status === "published")
    if (allPublished) return "complete"
    return "generated"
  }

  switch (video.status) {
    case "uploaded":
      return "uploaded"
    case "transcribing":
    case "failed":
      return "transcribing"
    case "transcribed":
    case "analyzed":
      return "transcribed"
  }
}

export function videosByColumn(videos: VideoUpload[], posts: SocialPost[]): Record<VideoColumn, VideoUpload[]> {
  const out: Record<VideoColumn, VideoUpload[]> = {
    uploaded: [],
    transcribing: [],
    transcribed: [],
    generated: [],
    complete: [],
  }
  for (const v of videos) out[videoColumnFor(v, posts)].push(v)
  return out
}

export function postColumnFor(post: SocialPost): PostColumn | null {
  switch (post.approval_status) {
    case "draft":
    case "edited":
      return "needs_review"
    case "approved":
    case "awaiting_connection":
      return "approved"
    case "scheduled":
      return "scheduled"
    case "published":
      return "published"
    case "failed":
      return "failed"
    case "rejected":
      return null
  }
}

export function postsByColumn<P extends SocialPost>(posts: P[]): Record<PostColumn, P[]> {
  const out: Record<PostColumn, P[]> = {
    needs_review: [],
    approved: [],
    scheduled: [],
    published: [],
    failed: [],
  }
  for (const p of posts) {
    const col = postColumnFor(p)
    if (col) out[col].push(p)
  }
  return out
}
