import { describe, it, expect } from "vitest"
import { computeStudioInsights, summarizeVideoPerformance } from "@/lib/content-studio/insights"
import type { SocialPost, SocialAnalytics, VideoUpload } from "@/types/database"

const NOW = new Date("2026-09-20T12:00:00Z")

function video(over: Partial<VideoUpload> = {}): VideoUpload {
  return {
    id: "v1", storage_path: "p.mp4", original_filename: "p.mp4", duration_seconds: 30,
    size_bytes: 1000, mime_type: "video/mp4", title: null, uploaded_by: null,
    status: "analyzed", needs_edit: false,
    created_at: "2026-09-19T12:00:00Z", updated_at: "2026-09-19T12:00:00Z", ...over,
  } as VideoUpload
}

function post(over: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "p1", platform: "instagram", content: "hi", media_url: null, post_type: "reel",
    approval_status: "draft", scheduled_at: null, published_at: null, source_video_id: "v1",
    rejection_notes: null, platform_post_id: null, created_by: null,
    created_at: "2026-09-19T12:00:00Z", updated_at: "2026-09-19T12:00:00Z", ...over,
  } as SocialPost
}

function base(over: Partial<Parameters<typeof computeStudioInsights>[0]> = {}) {
  return {
    now: NOW, videos: [], posts: [], analytics: [], assets: [], submissions: [],
    connectedPlatforms: new Set(["instagram", "youtube"]),
    periodDays: 30, ...over,
  }
}

describe("performance empty states — a zero and an absence are different answers", () => {
  it("not_published when the video has no published post", () => {
    const out = computeStudioInsights(base({ videos: [video()], posts: [post()] }))
    expect(out.performance.videos[0].state).toEqual({ kind: "not_published" })
  })

  it("awaiting_sync when published but no snapshot exists", () => {
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
    }))
    expect(out.performance.videos[0].state).toEqual({
      kind: "awaiting_sync", publishedAt: "2026-09-19T12:00:00Z",
    })
  })

  it("not_connected takes priority over awaiting_sync", () => {
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ platform: "linkedin", approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
      connectedPlatforms: new Set(["instagram"]),
    }))
    expect(out.performance.videos[0].perPost[0].state).toEqual({ kind: "not_connected", platform: "linkedin" })
  })

  it("measured — and a real zero stays a zero, not an empty state", () => {
    const analytics = [{
      id: "a1", social_post_id: "p1", platform: "instagram", platform_post_id: "abc",
      impressions: 0, engagement: 0, likes: 0, comments: 0, shares: 0, views: 0,
      extra: null, recorded_at: "2026-09-20T03:00:00Z", created_at: "2026-09-20T03:00:00Z",
    }] as SocialAnalytics[]
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
      analytics,
    }))
    expect(out.performance.videos[0].state).toEqual({
      kind: "measured", views: 0, likes: 0, comments: 0, shares: 0,
    })
  })

  it("uses the LATEST snapshot per post, never the sum", () => {
    const analytics = [
      { id: "a1", social_post_id: "p1", platform: "instagram", platform_post_id: "abc", impressions: null, engagement: null, likes: 5, comments: 0, shares: 0, views: 100, extra: null, recorded_at: "2026-09-18T03:00:00Z", created_at: "" },
      { id: "a2", social_post_id: "p1", platform: "instagram", platform_post_id: "abc", impressions: null, engagement: null, likes: 9, comments: 0, shares: 0, views: 250, extra: null, recorded_at: "2026-09-20T03:00:00Z", created_at: "" },
    ] as SocialAnalytics[]
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ approval_status: "published", published_at: "2026-09-19T12:00:00Z", platform_post_id: "abc" })],
      analytics,
    }))
    expect(out.performance.videos[0].state).toEqual({ kind: "measured", views: 250, likes: 9, comments: 0, shares: 0 })
    expect(out.performance.totals.views).toBe(250)
  })
})

describe("cross-post aggregation — the common case in production (9 videos × 6 platforms)", () => {
  // Every "measured" fixture above has exactly one post. A video cross-posted
  // to several platforms is the normal shape of this product, so this pins
  // the untested path: video-level state SUMS every measured post (not just
  // the first), measuredPostCount counts every measured post (not zero of
  // them), and totals accumulates all four metrics (not just views) across
  // all measured posts.
  it("sums BOTH posts across all four metrics, using each post's own latest snapshot — not a sum of all snapshots", () => {
    const posts = [
      post({
        id: "pA", platform: "instagram", approval_status: "published",
        published_at: "2026-09-18T12:00:00Z", platform_post_id: "ig1",
        source_video_id: "v-cross",
      }),
      post({
        id: "pB", platform: "youtube", approval_status: "published",
        published_at: "2026-09-18T13:00:00Z", platform_post_id: "yt1",
        source_video_id: "v-cross",
      }),
    ]
    const analytics = [
      // Post A: two snapshots. The OLD one must be ignored — summing both
      // would double-count A's contribution to the video-level total.
      { id: "a1", social_post_id: "pA", platform: "instagram", platform_post_id: "ig1", impressions: null, engagement: null, views: 50, likes: 5, comments: 2, shares: 1, extra: null, recorded_at: "2026-09-19T00:00:00Z", created_at: "" },
      { id: "a2", social_post_id: "pA", platform: "instagram", platform_post_id: "ig1", impressions: null, engagement: null, views: 300, likes: 30, comments: 7, shares: 4, extra: null, recorded_at: "2026-09-20T00:00:00Z", created_at: "" },
      // Post B: single snapshot, distinct values on every metric so a
      // transposed or dropped field is visible.
      { id: "b1", social_post_id: "pB", platform: "youtube", platform_post_id: "yt1", impressions: null, engagement: null, views: 1000, likes: 9, comments: 60, shares: 11, extra: null, recorded_at: "2026-09-20T01:00:00Z", created_at: "" },
    ] as SocialAnalytics[]

    const out = computeStudioInsights(base({
      videos: [video({ id: "v-cross", created_at: "2026-09-01T00:00:00Z" })],
      posts,
      analytics,
    }))

    // Per-post: each post reports its OWN latest snapshot.
    expect(out.performance.videos[0].perPost).toEqual([
      { postId: "pA", platform: "instagram", state: { kind: "measured", views: 300, likes: 30, comments: 7, shares: 4 } },
      { postId: "pB", platform: "youtube", state: { kind: "measured", views: 1000, likes: 9, comments: 60, shares: 11 } },
    ])

    // Video-level: the SUM of both posts, all four metrics.
    expect(out.performance.videos[0].state).toEqual({
      kind: "measured", views: 1300, likes: 39, comments: 67, shares: 15,
    })

    expect(out.performance.measuredPostCount).toBe(2)
    expect(out.performance.totals).toEqual({ views: 1300, likes: 39, comments: 67, shares: 15 })
  })
})

describe("production band", () => {
  it("counts this period against the previous one", () => {
    const out = computeStudioInsights(base({
      videos: [
        video({ id: "recent", created_at: "2026-09-15T00:00:00Z" }),
        video({ id: "older", created_at: "2026-08-15T00:00:00Z" }),
      ],
      periodDays: 30,
    }))
    expect(out.production.videosUploaded).toBe(1)
    expect(out.production.videosUploadedPrevious).toBe(1)
  })

  it("counts videos held by the edit gate", () => {
    const out = computeStudioInsights(base({
      videos: [video({ id: "a", needs_edit: true }), video({ id: "b", needs_edit: false })],
    }))
    expect(out.production.videosBlockedByEditGate).toBe(1)
  })

  it("reports the oldest item per stage in whole days", () => {
    const out = computeStudioInsights(base({
      videos: [video()],
      posts: [post({ id: "old", created_at: "2026-09-05T12:00:00Z" })],
    }))
    const draft = out.production.oldestInStage.find((s) => s.stage === "draft")
    expect(draft?.ageDays).toBe(15)
  })

  it("returns zeroes, not a crash, on entirely empty input", () => {
    const out = computeStudioInsights(base())
    expect(out.production.videosUploaded).toBe(0)
    expect(out.performance.videos).toEqual([])
    expect(out.performance.measuredPostCount).toBe(0)
  })

  it("period boundary is inclusive — a video created exactly periodDays ago counts in the current period", () => {
    // now - 30 days, to the millisecond. The brief's own "counts this period
    // against the previous one" test never lands on this exact instant, so it
    // cannot distinguish >= from > on the boundary — this one can.
    const out = computeStudioInsights(base({
      videos: [video({ id: "on-boundary", created_at: "2026-08-21T12:00:00.000Z" })],
      periodDays: 30,
    }))
    expect(out.production.videosUploaded).toBe(1)
  })
})

describe("summarizeVideoPerformance — the single copy of the ladder, called directly", () => {
  // computeStudioInsights delegates to this function per video. A later task
  // (the video detail page) calls it directly with just one video's posts +
  // analytics, without fetching every video/asset/submission in the database.
  // This suite exercises that call path independently of computeStudioInsights
  // so the resolution order is pinned at the function that owns it, not just
  // through the aggregator that happens to call it.
  it("resolves not_connected before awaiting_sync when called directly, with no aggregator involved", () => {
    const posts = [
      post({
        id: "p9",
        platform: "linkedin",
        approval_status: "published",
        published_at: "2026-09-19T12:00:00Z",
        platform_post_id: "abc",
        source_video_id: "v9",
      }),
    ]
    const summary = summarizeVideoPerformance("v9", posts, [], new Set(["instagram"]))
    expect(summary.perPost[0].state).toEqual({ kind: "not_connected", platform: "linkedin" })
    expect(summary.state).toEqual({ kind: "not_connected", platform: "linkedin" })
  })
})
