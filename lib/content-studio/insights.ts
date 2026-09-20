// lib/content-studio/insights.ts
// Pure aggregator for the Content Studio Insights tab. Rows in, numbers out —
// no I/O and no Date.now(), so every branch is reachable from a fixture.
//
// The four PerformanceState variants exist because production has zero
// published posts. Collapsing "nothing published", "published but not yet
// synced", "platform not connected" and "measured, genuinely zero" into a
// single 0 would make an untouched dashboard look like a failing one — and
// would keep looking fine for months after it actually broke.
//
// summarizeVideoPerformance is the single copy of the four-state ladder. A
// later task (the video detail page) calls it directly with just that one
// video's posts + analytics, instead of pulling every video/asset/submission
// in the database through computeStudioInsights to read one entry out of
// performance.videos. computeStudioInsights calls this same function once
// per video, so the Insights tab and the video detail page can never
// disagree about the same video's state.

import type {
  VideoUpload,
  SocialPost,
  SocialAnalytics,
  MediaAsset,
  TeamVideoSubmission,
  SocialPlatform,
} from "@/types/database"

export type PerformanceState =
  | { kind: "not_published" }
  | { kind: "awaiting_sync"; publishedAt: string }
  | { kind: "not_connected"; platform: SocialPlatform }
  | { kind: "measured"; views: number; likes: number; comments: number; shares: number }

/** Named ...Summary, not VideoPerformance — a later task adds a COMPONENT by that name. */
export interface VideoPerformanceSummary {
  videoId: string
  state: PerformanceState
  perPost: Array<{ postId: string; platform: SocialPlatform; state: PerformanceState }>
}

export interface StudioInsightsInput {
  now: Date
  videos: VideoUpload[]
  posts: SocialPost[]
  analytics: SocialAnalytics[]
  assets: MediaAsset[]
  submissions: TeamVideoSubmission[]
  /** plugin_name of every connection whose status is 'connected'. */
  connectedPlatforms: Set<string>
  periodDays: number
}

export interface StudioInsights {
  production: {
    videosUploaded: number
    videosUploadedPrevious: number
    postsByStage: Record<string, number>
    videosBlockedByEditGate: number
    assetsByKind: Record<string, number>
    assetBytes: number
    teamSubmissionsByStatus: Record<string, number>
    oldestInStage: Array<{ stage: string; ageDays: number; label: string }>
  }
  performance: {
    videos: VideoPerformanceSummary[]
    totals: { views: number; likes: number; comments: number; shares: number }
    measuredPostCount: number
  }
}

function latestSnapshotByPost(analytics: SocialAnalytics[]): Map<string, SocialAnalytics> {
  // Snapshots are cumulative totals, not deltas — summing them would multiply
  // every view count by the number of sync runs. Keep only the newest per post.
  //
  // `>` is strict, so two rows with an identical recorded_at keep whichever
  // one this loop saw first, and Postgres gives no ordering guarantee over
  // ties. Separately, every comparison against NaN is false, so a row with an
  // unparseable recorded_at would silently win or lose forever instead of
  // raising — recorded_at is NOT NULL timestamptz, so this shouldn't arise in
  // practice, but neither failure mode surfaces as an error if it ever does.
  const latest = new Map<string, SocialAnalytics>()
  for (const row of analytics) {
    const existing = latest.get(row.social_post_id)
    if (!existing || new Date(row.recorded_at) > new Date(existing.recorded_at)) {
      latest.set(row.social_post_id, row)
    }
  }
  return latest
}

// Resolution order per post, pinned by tests:
// 1. not published                       -> not_published
// 2. platform not in connectedPlatforms   -> not_connected
// 3. no snapshot for the post yet         -> awaiting_sync
// 4. otherwise                            -> measured, from the latest snapshot
function statePerPost(
  post: SocialPost,
  latest: Map<string, SocialAnalytics>,
  connected: Set<string>,
): PerformanceState {
  if (post.approval_status !== "published" || !post.published_at) {
    return { kind: "not_published" }
  }
  if (!connected.has(post.platform)) {
    return { kind: "not_connected", platform: post.platform }
  }
  const snap = latest.get(post.id)
  if (!snap) {
    return { kind: "awaiting_sync", publishedAt: post.published_at }
  }
  return {
    kind: "measured",
    views: snap.views ?? 0,
    likes: snap.likes ?? 0,
    comments: snap.comments ?? 0,
    shares: snap.shares ?? 0,
  }
}

/**
 * The one copy of the four-state performance ladder, scoped to a single
 * video. `posts` and `analytics` may be the full tables or a subset already
 * filtered to this video's own posts — this filters by `source_video_id`
 * itself, so either works identically.
 */
export function summarizeVideoPerformance(
  videoId: string,
  posts: SocialPost[],
  analytics: SocialAnalytics[],
  connectedPlatforms: Set<string>,
): VideoPerformanceSummary {
  const latest = latestSnapshotByPost(analytics)
  const own = posts.filter((p) => p.source_video_id === videoId)
  const perPost = own.map((p) => ({
    postId: p.id,
    platform: p.platform,
    state: statePerPost(p, latest, connectedPlatforms),
  }))

  const measured = perPost.filter(
    (p): p is (typeof perPost)[number] & { state: Extract<PerformanceState, { kind: "measured" }> } =>
      p.state.kind === "measured",
  )

  let state: PerformanceState
  if (measured.length > 0) {
    // Video-level state SUMS every measured post's own latest snapshot. That
    // means a video with one measured post and one post on a disconnected
    // platform still reports `measured` at the video level — the
    // disconnected post's absence is invisible in `state` alone. `perPost` is
    // where that truth lives: any consumer that needs to know WHICH platforms
    // are measured, blocked, or awaiting sync — the video detail page, in
    // particular — must render `perPost`, not just `state`.
    const agg = { views: 0, likes: 0, comments: 0, shares: 0 }
    for (const m of measured) {
      agg.views += m.state.views
      agg.likes += m.state.likes
      agg.comments += m.state.comments
      agg.shares += m.state.shares
    }
    state = { kind: "measured", ...agg }
  } else {
    state = perPost[0]?.state ?? { kind: "not_published" }
  }

  return { videoId, state, perPost }
}

export function computeStudioInsights(input: StudioInsightsInput): StudioInsights {
  const { now, videos, posts, analytics, assets, submissions, connectedPlatforms, periodDays } = input
  const periodMs = periodDays * 86_400_000
  const periodStart = new Date(now.getTime() - periodMs)
  const previousStart = new Date(now.getTime() - periodMs * 2)

  const totals = { views: 0, likes: 0, comments: 0, shares: 0 }
  let measuredPostCount = 0

  // Delegates to summarizeVideoPerformance per video rather than inlining the
  // ladder here — see the header comment for why there is exactly one copy.
  const perVideo: VideoPerformanceSummary[] = videos.map((v) => {
    const summary = summarizeVideoPerformance(v.id, posts, analytics, connectedPlatforms)
    measuredPostCount += summary.perPost.filter((p) => p.state.kind === "measured").length
    if (summary.state.kind === "measured") {
      totals.views += summary.state.views
      totals.likes += summary.state.likes
      totals.comments += summary.state.comments
      totals.shares += summary.state.shares
    }
    return summary
  })

  const postsByStage: Record<string, number> = {}
  const oldestByStage = new Map<string, string>()
  for (const p of posts) {
    postsByStage[p.approval_status] = (postsByStage[p.approval_status] ?? 0) + 1
    const current = oldestByStage.get(p.approval_status)
    if (!current || new Date(p.created_at) < new Date(current)) {
      oldestByStage.set(p.approval_status, p.created_at)
    }
  }

  const assetsByKind: Record<string, number> = {}
  let assetBytes = 0
  for (const a of assets) {
    assetsByKind[a.kind] = (assetsByKind[a.kind] ?? 0) + 1
    assetBytes += a.bytes ?? 0
  }

  const teamSubmissionsByStatus: Record<string, number> = {}
  for (const s of submissions) {
    teamSubmissionsByStatus[s.status] = (teamSubmissionsByStatus[s.status] ?? 0) + 1
  }

  const STAGE_LABEL: Record<string, string> = {
    draft: "Drafts",
    edited: "Edited",
    approved: "Approved",
    scheduled: "Scheduled",
    published: "Published",
    rejected: "Rejected",
    awaiting_connection: "Waiting on a connection",
    failed: "Failed",
  }

  return {
    production: {
      videosUploaded: videos.filter((v) => new Date(v.created_at) >= periodStart).length,
      videosUploadedPrevious: videos.filter((v) => {
        const t = new Date(v.created_at)
        return t >= previousStart && t < periodStart
      }).length,
      postsByStage,
      videosBlockedByEditGate: videos.filter((v) => v.needs_edit).length,
      assetsByKind,
      assetBytes,
      teamSubmissionsByStatus,
      oldestInStage: Array.from(oldestByStage.entries())
        .map(([stage, iso]) => ({
          stage,
          ageDays: Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000),
          label: STAGE_LABEL[stage] ?? stage,
        }))
        .sort((a, b) => b.ageDays - a.ageDays),
    },
    performance: { videos: perVideo, totals, measuredPostCount },
  }
}
