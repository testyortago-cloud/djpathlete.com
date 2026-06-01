import type { SocialPost, VideoUpload } from "@/types/database"
import { isVideoPostable } from "@/lib/content-studio/postable"

export const VIDEO_COLUMNS = ["uploaded", "transcribing", "transcribed", "generated", "complete"] as const
export type VideoColumn = (typeof VIDEO_COLUMNS)[number]

export const VIDEO_COLUMN_LABELS: Record<VideoColumn, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  transcribed: "Transcribed",
  generated: "Generated",
  complete: "Complete",
}

// ── 7-column variant: shown when feature_captioned_cut_enabled is on. The three
// edit columns (needs_edit/rendering/edited) replace the single "transcribed"
// column, since a transcribed video is needs_edit=true by default and so is
// immediately "needs edit". The original VIDEO_COLUMNS path is the flag-off
// fallback and is left untouched.
export const VIDEO_COLUMNS_WITH_EDIT = [
  "uploaded",
  "transcribing",
  "needs_edit",
  "rendering",
  "edited",
  "generated",
  "complete",
] as const
export type VideoColumnWithEdit = (typeof VIDEO_COLUMNS_WITH_EDIT)[number]

export const VIDEO_COLUMN_WITH_EDIT_LABELS: Record<VideoColumnWithEdit, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  needs_edit: "Needs Edit",
  rendering: "Rendering",
  edited: "Edited",
  generated: "Generated",
  complete: "Complete",
}

/** Per-video signals the 7-column derivation needs that aren't on the row itself. */
export interface VideoEditSignals {
  /** A rendered captioned-cut asset exists for this video. */
  hasCut: boolean
  /** An in-flight (pending/processing) video_caption_render job exists. */
  isRendering: boolean
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

export function videoColumnForWithEdit(
  video: VideoUpload,
  posts: SocialPost[],
  signals: VideoEditSignals,
): VideoColumnWithEdit {
  // An in-flight captioned-cut render wins over everything else — including a
  // video that already generated posts (a re-render) or has a finished cut — so
  // the active render is always visible in the Rendering column. The card settles
  // back into its post/edit-derived column once the render finishes.
  if (signals.isRendering) return "rendering"

  const myPosts = posts.filter((p) => p.source_video_id === video.id)
  // Fully shipped: every post published → Complete, regardless of edit state.
  if (myPosts.length > 0 && myPosts.every((p) => p.approval_status === "published")) return "complete"

  switch (video.status) {
    case "uploaded":
      return "uploaded"
    case "transcribing":
    case "failed":
      return "transcribing"
    case "transcribed":
    case "analyzed":
      // Editing gate precedes generation. The auto-fanout drafts caption posts
      // the moment transcription finishes, so a transcribed video that still
      // needs a cut would otherwise skip straight to "generated" and the cut
      // would never get rendered. Keep it in needs_edit until it's postable
      // (cut rendered or marked ready); only THEN does post state drive the
      // column (→ generated when posts exist, → edited when they don't).
      if (!isVideoPostable(video, signals.hasCut)) return "needs_edit"
      return myPosts.length > 0 ? "generated" : "edited"
    default: {
      // exhaustiveness guard — a new VideoUploadStatus becomes a compile error here
      const _never: never = video.status
      return _never
    }
  }
}

export function videosByColumnWithEdit(
  videos: VideoUpload[],
  posts: SocialPost[],
  lookups: { cutVideoIds: Set<string>; renderingVideoIds: Set<string> },
): Record<VideoColumnWithEdit, VideoUpload[]> {
  const out: Record<VideoColumnWithEdit, VideoUpload[]> = {
    uploaded: [],
    transcribing: [],
    needs_edit: [],
    rendering: [],
    edited: [],
    generated: [],
    complete: [],
  }
  for (const v of videos) {
    const col = videoColumnForWithEdit(v, posts, {
      hasCut: lookups.cutVideoIds.has(v.id),
      isRendering: lookups.renderingVideoIds.has(v.id),
    })
    out[col].push(v)
  }
  return out
}
