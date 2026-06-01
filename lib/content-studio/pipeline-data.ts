import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsForPipeline, type PipelinePostRow } from "@/lib/db/social-posts"
import { listCaptionedCutVideoIds } from "@/lib/db/media-assets"
import { getAdminStorage } from "@/lib/firebase-admin"
import type { VideoUpload } from "@/types/database"
import type { RecentCaptionRender } from "@/lib/ai-jobs"
import { listRecentCaptionRenders } from "@/lib/ai-jobs"
import { getSetting } from "@/lib/db/system-settings"

const THUMBNAIL_URL_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes

export interface PipelineData {
  videos: VideoUpload[]
  posts: PipelinePostRow[]
  postCountsByVideo: Record<string, PostCounts>
  /** Signed read URL per video-id, only for videos that have a thumbnail_path. */
  thumbnailUrlsByVideo: Record<string, string>
  /** Video ids that have a rendered captioned-cut asset (for the "Cut" badge). */
  cutVideoIds: Set<string>
  /** True when feature_captioned_cut_enabled is on — switches the lane to 7 columns. */
  captionedCutEnabled: boolean
  /** videoUploadId → in-flight render job id (keys = the "rendering" column). */
  renderJobIdByVideo: Record<string, string>
  /** Videos whose latest render failed and that have no cut (failed badge). */
  failedRenderVideoIds: Set<string>
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

const IN_FLIGHT_RENDER_STATUSES: ReadonlySet<RecentCaptionRender["status"]> = new Set([
  "pending",
  "processing",
  "streaming",
])

export interface RenderSignals {
  /** videoUploadId → in-flight render job id. Keys are also the "rendering" set. */
  renderJobIdByVideo: Record<string, string>
  /** Videos whose LATEST render failed and that have no rendered cut. */
  failedRenderVideoIds: Set<string>
}

/**
 * Reduce recent render rows (newest-first) to per-video edit signals. Only the
 * latest render per video matters: if it's in flight → rendering; if it failed and
 * no cut exists → show the failed badge; otherwise no render signal.
 */
export function deriveRenderSignals(
  recentRenders: RecentCaptionRender[],
  cutVideoIds: Set<string>,
): RenderSignals {
  const renderJobIdByVideo: Record<string, string> = {}
  const failedRenderVideoIds = new Set<string>()
  const seen = new Set<string>()

  for (const render of recentRenders) {
    if (seen.has(render.videoUploadId)) continue // newest-first: skip older rows
    seen.add(render.videoUploadId)

    if (IN_FLIGHT_RENDER_STATUSES.has(render.status)) {
      renderJobIdByVideo[render.videoUploadId] = render.jobId
    } else if (render.status === "failed" && !cutVideoIds.has(render.videoUploadId)) {
      failedRenderVideoIds.add(render.videoUploadId)
    }
    // "completed" and "cancelled" are intentionally ignored — a finished cut shows
    // via cutVideoIds (→ "edited"), and a cancelled render needs no badge.
  }

  return { renderJobIdByVideo, failedRenderVideoIds }
}

export async function getPipelineData(): Promise<PipelineData> {
  const [videos, posts, cutVideoIds, captionedCutEnabled] = await Promise.all([
    listVideoUploads({ limit: 200 }),
    listSocialPostsForPipeline(),
    listCaptionedCutVideoIds(),
    getSetting<boolean>("feature_captioned_cut_enabled", false),
  ])

  // Render signals only matter when the edit lane is active.
  let renderJobIdByVideo: Record<string, string> = {}
  let failedRenderVideoIds = new Set<string>()
  if (captionedCutEnabled) {
    const recentRenders = await listRecentCaptionRenders()
    const signals = deriveRenderSignals(recentRenders, cutVideoIds)
    renderJobIdByVideo = signals.renderJobIdByVideo
    failedRenderVideoIds = signals.failedRenderVideoIds
  }

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

  return {
    videos,
    posts,
    postCountsByVideo,
    thumbnailUrlsByVideo,
    cutVideoIds,
    captionedCutEnabled,
    renderJobIdByVideo,
    failedRenderVideoIds,
  }
}
