import { describe, it, expect, vi, beforeEach } from "vitest"
import { runSyncPlatformAnalytics } from "../sync-platform-analytics.js"

interface InsertCall {
  social_post_id: string
  platform: string
  platform_post_id: string
  impressions: number | null
  engagement: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  views: number | null
  extra: Record<string, number> | null
  recorded_at: string
}

function makeSupabaseStub(posts: Array<{ id: string; platform: string; platform_post_id: string }>) {
  const inserts: InsertCall[] = []
  const insertMock = vi.fn(async (row: InsertCall) => {
    inserts.push(row)
    return { error: null }
  })

  const stub = {
    from(table: string) {
      if (table === "social_posts") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                order: () => ({
                  limit: async () => ({ data: posts, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === "social_analytics") {
        return { insert: (row: InsertCall) => insertMock(row) }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return { stub, inserts, insertMock }
}

describe("runSyncPlatformAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("inserts one social_analytics row per post when the route returns metrics", async () => {
    const { stub, inserts } = makeSupabaseStub([{ id: "p1", platform: "facebook", platform_post_id: "fb_1" }])
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            socialPostId: "p1",
            platform: "facebook",
            platformPostId: "fb_1",
            metrics: { impressions: 200, engagement: 10 },
          }),
          { status: 200 },
        ),
    )

    const result = await runSyncPlatformAnalytics({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(result).toEqual({ synced: 1, skipped: 0, failed: 0 })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].impressions).toBe(200)
    expect(inserts[0].engagement).toBe(10)
    expect(inserts[0].platform_post_id).toBe("fb_1")
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.local/api/admin/internal/sync-post-analytics",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    )
  })

  it("skips posts when the plugin is not connected (metrics null)", async () => {
    const { stub, inserts } = makeSupabaseStub([{ id: "p1", platform: "tiktok", platform_post_id: "tt_1" }])
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            socialPostId: "p1",
            platform: "tiktok",
            platformPostId: "tt_1",
            metrics: null,
            reason: "plugin_not_connected",
          }),
          { status: 200 },
        ),
    )

    const result = await runSyncPlatformAnalytics({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(result).toEqual({ synced: 0, skipped: 1, failed: 0 })
    expect(inserts).toHaveLength(0)
  })

  it("counts failed when the route returns non-200", async () => {
    const { stub, inserts } = makeSupabaseStub([{ id: "p1", platform: "youtube", platform_post_id: "yt_1" }])
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 502 }))

    const result = await runSyncPlatformAnalytics({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(result).toEqual({ synced: 0, skipped: 0, failed: 1 })
    expect(inserts).toHaveLength(0)
  })

  it("captures extra metric keys outside the core six in the extra column", async () => {
    const { stub, inserts } = makeSupabaseStub([{ id: "p1", platform: "instagram", platform_post_id: "ig_1" }])
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            socialPostId: "p1",
            platform: "instagram",
            platformPostId: "ig_1",
            metrics: { impressions: 500, saved: 12, profile_visits: 7 },
          }),
          { status: 200 },
        ),
    )

    const result = await runSyncPlatformAnalytics({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(result.synced).toBe(1)
    expect(inserts[0].extra).toEqual({ saved: 12, profile_visits: 7 })
  })

  it("returns zeros when there are no published posts", async () => {
    const { stub } = makeSupabaseStub([])
    const fetchImpl = vi.fn()

    const result = await runSyncPlatformAnalytics({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      fetchImpl,
      internalToken: "tok",
      appUrl: "https://app.local",
    })

    expect(result).toEqual({ synced: 0, skipped: 0, failed: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("throws if INTERNAL_CRON_TOKEN is missing", async () => {
    const { stub } = makeSupabaseStub([])
    await expect(
      runSyncPlatformAnalytics({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseImpl: stub as any,
        fetchImpl: vi.fn(),
        internalToken: "",
        appUrl: "https://app.local",
      }),
    ).rejects.toThrow(/INTERNAL_CRON_TOKEN/)
  })

  it("throws if APP_URL is missing", async () => {
    const { stub } = makeSupabaseStub([])
    await expect(
      runSyncPlatformAnalytics({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseImpl: stub as any,
        fetchImpl: vi.fn(),
        internalToken: "tok",
        appUrl: "",
      }),
    ).rejects.toThrow(/APP_URL/)
  })
})
