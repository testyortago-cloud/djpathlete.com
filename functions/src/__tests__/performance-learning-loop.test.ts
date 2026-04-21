import { describe, it, expect, vi, beforeEach } from "vitest"
import { runPerformanceLearningLoop } from "../performance-learning-loop.js"

interface FakePost {
  id: string
  content: string
  platform: string
  published_at: string
}

interface FakeAnalytics {
  social_post_id: string
  impressions: number
  engagement: number
  recorded_at: string
}

interface FakeData {
  posts: Record<string, FakePost[]> // keyed by platform
  analytics: FakeAnalytics[]
}

interface UpdateCall {
  platform: string
  examples: unknown
}

function makeSupabaseStub(data: FakeData) {
  const updates: UpdateCall[] = []

  const stub = {
    from(table: string) {
      if (table === "social_posts") {
        return {
          select: () => {
            let filterPlatform: string | null = null
            const chain = {
              eq: (col: string, val: string) => {
                if (col === "platform") filterPlatform = val
                return chain
              },
              gte: () => chain,
              order: () => chain,
              limit: async () => ({
                data: filterPlatform !== null ? (data.posts[filterPlatform] ?? []) : [],
                error: null,
              }),
            }
            return chain
          },
        }
      }

      if (table === "social_analytics") {
        return {
          select: () => {
            let capturedIds: string[] = []
            const chain = {
              in: (_col: string, ids: string[]) => {
                capturedIds = ids
                return chain
              },
              gte: () => chain,
              order: async () => ({
                data: data.analytics.filter((a) => capturedIds.includes(a.social_post_id)),
                error: null,
              }),
            }
            return chain
          },
        }
      }

      if (table === "prompt_templates") {
        return {
          update: (payload: { few_shot_examples: unknown }) => {
            let capturedPlatform: string | null = null
            const chain = {
              eq: (col: string, val: string) => {
                if (col === "scope") capturedPlatform = val
                if (col === "scope" || col === "category") {
                  // last eq call resolves
                }
                return chain.eq === undefined ? chain : chain
              },
            }
            // Return a thenable so `await` resolves and eq-chains are applied.
            // Simpler: return an object whose final `.eq` triggers the push.
            const finalChain = {
              eq(col: string, val: string) {
                if (col === "scope") capturedPlatform = val
                // Two .eq() calls happen: category then scope. Push on the
                // second call.
                if (capturedPlatform !== null) {
                  updates.push({
                    platform: capturedPlatform,
                    examples: payload.few_shot_examples,
                  })
                }
                return Promise.resolve({ error: null })
              },
            }
            return {
              eq(col: string, val: string) {
                // first eq (category): just chain
                return finalChain
              },
            }
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return { stub, updates }
}

const NOW = new Date("2026-04-21T03:00:00Z")

describe("runPerformanceLearningLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("picks top-N posts by engagement per platform and updates the matching template row", async () => {
    const data: FakeData = {
      posts: {
        instagram: [
          { id: "ig1", content: "caption A", platform: "instagram", published_at: "2026-04-15" },
          { id: "ig2", content: "caption B", platform: "instagram", published_at: "2026-04-16" },
          { id: "ig3", content: "caption C", platform: "instagram", published_at: "2026-04-17" },
          { id: "ig4", content: "caption D", platform: "instagram", published_at: "2026-04-18" },
        ],
        facebook: [],
        tiktok: [],
        youtube: [],
        youtube_shorts: [],
        linkedin: [],
      },
      analytics: [
        // ig1 has two snapshots — only the newest should count
        { social_post_id: "ig1", impressions: 100, engagement: 30, recorded_at: "2026-04-16T00:00:00Z" },
        { social_post_id: "ig1", impressions: 500, engagement: 50, recorded_at: "2026-04-20T00:00:00Z" },
        { social_post_id: "ig2", impressions: 400, engagement: 90, recorded_at: "2026-04-19T00:00:00Z" },
        { social_post_id: "ig3", impressions: 200, engagement: 70, recorded_at: "2026-04-19T00:00:00Z" },
        { social_post_id: "ig4", impressions: 50, engagement: 0, recorded_at: "2026-04-19T00:00:00Z" },
      ],
    }
    const { stub, updates } = makeSupabaseStub(data)

    const result = await runPerformanceLearningLoop({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      now: NOW,
      topN: 3,
    })

    expect(result.platformsUpdated).toEqual(["instagram"])
    expect(result.platformsSkippedEmpty).toEqual(["facebook", "tiktok", "youtube", "youtube_shorts", "linkedin"])
    expect(result.totalExamplesWritten).toBe(3)
    expect(result.errors).toBe(0)

    expect(updates).toHaveLength(1)
    const examples = updates[0].examples as Array<{
      social_post_id: string
      engagement: number
    }>
    expect(examples[0].social_post_id).toBe("ig2") // engagement 90
    expect(examples[1].social_post_id).toBe("ig3") // 70
    expect(examples[2].social_post_id).toBe("ig1") // 50 (latest snapshot)
  })

  it("skips platforms with zero qualifying posts and does NOT clear their prior examples", async () => {
    const data: FakeData = {
      posts: {
        facebook: [],
        instagram: [],
        tiktok: [],
        youtube: [],
        youtube_shorts: [],
        linkedin: [],
      },
      analytics: [],
    }
    const { stub, updates } = makeSupabaseStub(data)

    const result = await runPerformanceLearningLoop({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      now: NOW,
    })

    expect(result.platformsUpdated).toEqual([])
    expect(result.platformsSkippedEmpty).toHaveLength(6)
    expect(result.totalExamplesWritten).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it("excludes posts with zero engagement", async () => {
    const data: FakeData = {
      posts: {
        youtube: [{ id: "yt1", content: "YT post", platform: "youtube", published_at: "2026-04-15" }],
        facebook: [],
        instagram: [],
        tiktok: [],
        youtube_shorts: [],
        linkedin: [],
      },
      analytics: [{ social_post_id: "yt1", impressions: 100, engagement: 0, recorded_at: "2026-04-16T00:00:00Z" }],
    }
    const { stub, updates } = makeSupabaseStub(data)

    const result = await runPerformanceLearningLoop({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      now: NOW,
    })

    expect(result.platformsSkippedEmpty).toContain("youtube")
    expect(updates).toHaveLength(0)
  })

  it("truncates long captions to 500 chars", async () => {
    const longContent = "x".repeat(1200)
    const data: FakeData = {
      posts: {
        linkedin: [{ id: "li1", content: longContent, platform: "linkedin", published_at: "2026-04-15" }],
        facebook: [],
        instagram: [],
        tiktok: [],
        youtube: [],
        youtube_shorts: [],
      },
      analytics: [{ social_post_id: "li1", impressions: 1000, engagement: 42, recorded_at: "2026-04-20T00:00:00Z" }],
    }
    const { stub, updates } = makeSupabaseStub(data)

    await runPerformanceLearningLoop({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseImpl: stub as any,
      now: NOW,
    })

    const examples = updates[0].examples as Array<{ caption: string }>
    expect(examples[0].caption.length).toBeLessThanOrEqual(500)
    expect(examples[0].caption.endsWith("…")).toBe(true)
  })
})
