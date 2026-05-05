import type { SocialPost, SocialPlatform, SocialApprovalStatus, VideoUpload } from "@/types/database"

const ALL_PLATFORMS: readonly SocialPlatform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "youtube_shorts",
  "linkedin",
]
const ALL_STATUSES: readonly SocialApprovalStatus[] = [
  "draft",
  "edited",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "awaiting_connection",
  "failed",
]

export interface PipelineFilters {
  platforms: SocialPlatform[]
  statuses: SocialApprovalStatus[]
  /** ISO-date "YYYY-MM-DD" or null. Inclusive. */
  from: string | null
  to: string | null
  sourceVideoId: string | null
}

export function parseFilters(sp: URLSearchParams): PipelineFilters {
  const platforms = (sp.get("platform") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SocialPlatform => (ALL_PLATFORMS as readonly string[]).includes(s))
  const statuses = (sp.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SocialApprovalStatus => (ALL_STATUSES as readonly string[]).includes(s))
  return {
    platforms,
    statuses,
    from: sp.get("from")?.trim() || null,
    to: sp.get("to")?.trim() || null,
    sourceVideoId: sp.get("sourceVideo")?.trim() || null,
  }
}

/**
 * Coerce an untrusted value (e.g. a jsonb column from user_preferences that
 * might be stale after a schema change) into a safe PipelineFilters, dropping
 * anything unexpected. Returns null if the input isn't a plain object.
 */
export function coerceStoredFilters(raw: unknown): PipelineFilters | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const platforms = Array.isArray(o.platforms)
    ? o.platforms.filter((x): x is SocialPlatform => (ALL_PLATFORMS as readonly string[]).includes(String(x)))
    : []
  const statuses = Array.isArray(o.statuses)
    ? o.statuses.filter((x): x is SocialApprovalStatus => (ALL_STATUSES as readonly string[]).includes(String(x)))
    : []
  const from = typeof o.from === "string" && o.from ? o.from : null
  const to = typeof o.to === "string" && o.to ? o.to : null
  const sourceVideoId = typeof o.sourceVideoId === "string" && o.sourceVideoId ? o.sourceVideoId : null
  return { platforms, statuses, from, to, sourceVideoId }
}

export function filtersToSearchParams(filters: PipelineFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (filters.platforms.length) sp.set("platform", filters.platforms.join(","))
  if (filters.statuses.length) sp.set("status", filters.statuses.join(","))
  if (filters.from) sp.set("from", filters.from)
  if (filters.to) sp.set("to", filters.to)
  if (filters.sourceVideoId) sp.set("sourceVideo", filters.sourceVideoId)
  return sp
}

function postMatchesTimeRange(post: SocialPost, from: string | null, to: string | null): boolean {
  if (!from && !to) return true
  const ref = post.scheduled_at ?? post.published_at ?? post.created_at
  const d = new Date(ref).getTime()
  if (Number.isNaN(d)) return true
  if (from) {
    const fromTs = new Date(`${from}T00:00:00Z`).getTime()
    if (d < fromTs) return false
  }
  if (to) {
    const toTs = new Date(`${to}T23:59:59.999Z`).getTime()
    if (d > toTs) return false
  }
  return true
}

export function applyFilters<P extends SocialPost>(
  videos: VideoUpload[],
  posts: P[],
  filters: PipelineFilters,
): { videos: VideoUpload[]; posts: P[] } {
  const filteredPosts = posts.filter((p) => {
    if (filters.platforms.length && !filters.platforms.includes(p.platform)) return false
    if (filters.statuses.length && !filters.statuses.includes(p.approval_status)) return false
    if (filters.sourceVideoId && p.source_video_id !== filters.sourceVideoId) return false
    if (!postMatchesTimeRange(p, filters.from, filters.to)) return false
    return true
  })

  const hasPostScopedFilter =
    filters.platforms.length > 0 ||
    filters.statuses.length > 0 ||
    filters.sourceVideoId !== null ||
    filters.from !== null ||
    filters.to !== null

  const videosWithAnyPost = new Set(posts.map((p) => p.source_video_id).filter((id): id is string => !!id))
  const allowedVideoIds = new Set(filteredPosts.map((p) => p.source_video_id).filter((id): id is string => !!id))
  // Pre-generation videos (uploaded/transcribing/transcribed with zero posts)
  // should always pass through — post-scoped filters can't possibly match them.
  // Videos that already have posts must match the filter via at least one post.
  const filteredVideos = hasPostScopedFilter
    ? videos.filter((v) => !videosWithAnyPost.has(v.id) || allowedVideoIds.has(v.id))
    : videos

  return { videos: filteredVideos, posts: filteredPosts }
}
