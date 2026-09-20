import { beforeEach, describe, expect, it, vi } from "vitest"

// getVideoPerformance is the video detail page's I/O entry point — it must
// fetch only this one video's posts + their analytics + the platform
// connections, never the whole-database sweep computeStudioInsights does.
vi.mock("@/lib/db/video-uploads", () => ({ listVideoUploads: vi.fn() }))
vi.mock("@/lib/db/social-posts", () => ({
  listSocialPostsForPipeline: vi.fn(),
  listSocialPostsBySourceVideo: vi.fn(),
}))
vi.mock("@/lib/db/social-analytics", () => ({
  listSocialAnalyticsInRange: vi.fn(),
  listSocialAnalyticsForPosts: vi.fn(),
}))
vi.mock("@/lib/db/media-assets", () => ({ listMediaAssets: vi.fn() }))
vi.mock("@/lib/db/team-video-submissions", () => ({ listAllSubmissions: vi.fn() }))
vi.mock("@/lib/db/platform-connections", () => ({ listPlatformConnections: vi.fn() }))

import { listVideoUploads } from "@/lib/db/video-uploads"
import { listSocialPostsBySourceVideo } from "@/lib/db/social-posts"
import { listSocialAnalyticsInRange, listSocialAnalyticsForPosts } from "@/lib/db/social-analytics"
import { listMediaAssets } from "@/lib/db/media-assets"
import { listAllSubmissions } from "@/lib/db/team-video-submissions"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { getVideoPerformance } from "@/lib/content-studio/insights-data"

function fixturePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    platform: "instagram" as const,
    content: "x",
    media_url: null,
    post_type: "video" as const,
    approval_status: "published" as const,
    scheduled_at: null,
    published_at: "2026-09-01T00:00:00Z",
    source_video_id: "video-1",
    rejection_notes: null,
    platform_post_id: null,
    created_by: "u",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

describe("getVideoPerformance", () => {
  beforeEach(() => {
    vi.mocked(listSocialPostsBySourceVideo).mockReset()
    vi.mocked(listSocialAnalyticsForPosts).mockReset().mockResolvedValue([])
    vi.mocked(listPlatformConnections).mockReset().mockResolvedValue([])
  })

  it("fetches only this video's own posts, scoped by videoId — never the whole-database tables", async () => {
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost()])
    await getVideoPerformance("video-1")
    expect(listSocialPostsBySourceVideo).toHaveBeenCalledWith("video-1")
    expect(listSocialPostsBySourceVideo).toHaveBeenCalledTimes(1)
    // The actual constraint this test exists to pin: computeStudioInsights's
    // whole-database fetchers must never run just to answer one video's panel.
    expect(listVideoUploads).not.toHaveBeenCalled()
    expect(listMediaAssets).not.toHaveBeenCalled()
    expect(listAllSubmissions).not.toHaveBeenCalled()
    expect(listSocialAnalyticsInRange).not.toHaveBeenCalled()
  })

  it("reuses posts passed in instead of re-fetching them", async () => {
    const posts = [fixturePost({ platform: "instagram" })]
    await getVideoPerformance("video-1", posts as never)
    expect(listSocialPostsBySourceVideo).not.toHaveBeenCalled()
    expect(listSocialAnalyticsForPosts).toHaveBeenCalledWith(["post-1"])
  })

  it("treats only status 'connected' as connected — a 'paused' platform is not_connected", async () => {
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost({ platform: "instagram" })])
    vi.mocked(listPlatformConnections).mockResolvedValueOnce([{ plugin_name: "instagram", status: "paused" } as never])
    const result = await getVideoPerformance("video-1")
    expect(result!.state).toMatchObject({ kind: "not_connected", platform: "instagram" })
  })

  it("treats an 'error' status platform as not_connected too", async () => {
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost({ platform: "instagram" })])
    vi.mocked(listPlatformConnections).mockResolvedValueOnce([{ plugin_name: "instagram", status: "error" } as never])
    const result = await getVideoPerformance("video-1")
    expect(result!.state.kind).toBe("not_connected")
  })

  it("reports measured once a snapshot exists for a connected platform's post", async () => {
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([fixturePost({ platform: "instagram" })])
    vi.mocked(listPlatformConnections).mockResolvedValueOnce([
      { plugin_name: "instagram", status: "connected" } as never,
    ])
    vi.mocked(listSocialAnalyticsForPosts).mockResolvedValueOnce([
      {
        social_post_id: "post-1",
        views: 5,
        likes: 1,
        comments: 0,
        shares: 0,
        recorded_at: "2026-09-02T00:00:00Z",
      } as never,
    ])
    const result = await getVideoPerformance("video-1")
    expect(result!.state).toMatchObject({ kind: "measured", views: 5, likes: 1 })
  })

  it("skips the analytics fetch entirely when the video has no posts", async () => {
    vi.mocked(listSocialPostsBySourceVideo).mockResolvedValueOnce([])
    const result = await getVideoPerformance("video-1")
    expect(listSocialAnalyticsForPosts).toHaveBeenCalledWith([])
    expect(result!.state).toEqual({ kind: "not_published" })
  })
})
