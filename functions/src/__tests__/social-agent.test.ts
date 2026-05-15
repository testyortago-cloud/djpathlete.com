import { describe, it, expect, vi } from "vitest"
import {
  buildCopywriterUserMessage,
  buildReviewerUserMessage,
  buildTrendingBlock,
  latestTavilyTopics,
  pickTopic,
  pickTopicWithBrief,
  type BlogTopic,
  type TavilyTopicRow,
} from "../social-agent.js"

describe("social-agent helpers", () => {
  it("buildCopywriterUserMessage includes platform, blog title, excerpt, and source body", () => {
    const msg = buildCopywriterUserMessage({
      platform: "linkedin",
      topic: {
        id: "b1",
        title: "Why your sprint mechanics suck after a hamstring strain",
        slug: "sprint-mechanics-hamstring",
        excerpt: "Most return-to-sport programs skip the eccentric phase.",
        content: "Long body content about hamstring rehab and force absorption.",
      },
    })
    expect(msg).toContain("Platform: linkedin")
    expect(msg).toContain("Why your sprint mechanics suck")
    expect(msg).toContain("Most return-to-sport programs")
    expect(msg).toContain("Long body content about hamstring rehab")
    expect(msg).toContain("Return JSON only")
  })

  it("buildCopywriterUserMessage falls back to excerpt when content is null", () => {
    const msg = buildCopywriterUserMessage({
      platform: "linkedin",
      topic: {
        id: "b1",
        title: "Title",
        slug: "title",
        excerpt: "Excerpt body used as source.",
        content: null,
      },
    })
    expect(msg).toContain("Excerpt body used as source.")
  })

  it("buildReviewerUserMessage exposes writer rules, draft text, and hashtags", () => {
    const msg = buildReviewerUserMessage({
      platform: "linkedin",
      writerRules: "Hook on line 1, no em-dashes.",
      draft: {
        caption_text: "Most coaches skip eccentrics. Here's why that breaks athletes.",
        hashtags: ["strength", "rehab"],
      },
    })
    expect(msg).toContain("Platform: linkedin")
    expect(msg).toContain("Writer rules")
    expect(msg).toContain("Hook on line 1")
    expect(msg).toContain("DRAFT caption_text")
    expect(msg).toContain("Most coaches skip eccentrics")
    expect(msg).toContain("DRAFT hashtags: strength, rehab")
  })

  it("buildReviewerUserMessage shows '(none)' when the draft has no hashtags", () => {
    const msg = buildReviewerUserMessage({
      platform: "linkedin",
      writerRules: "Short.",
      draft: { caption_text: "x", hashtags: [] },
    })
    expect(msg).toContain("DRAFT hashtags: (none)")
  })
})

describe("pickTopic", () => {
  function mockSupabase(opts: {
    byId?: BlogTopic | null
    recent?: BlogTopic[]
  }) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: opts.byId ?? null, error: null })
    const eqById = vi.fn().mockReturnValue({ maybeSingle })
    const selectById = vi.fn().mockReturnValue({ eq: eqById })

    const limit = vi.fn().mockResolvedValue({ data: opts.recent ?? [], error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const eqStatus = vi.fn().mockReturnValue({ order })
    const selectRecent = vi.fn().mockReturnValue({ eq: eqStatus })

    const from = vi.fn((table: string) => {
      if (table !== "blog_posts") throw new Error(`unexpected table ${table}`)
      // First call sets up the chain. Both branches start with .select(...),
      // so we return different chains based on what was already called.
      return {
        select: vi.fn((_cols: string) => {
          // If the caller is going to filter by id, eqById is hit; otherwise eqStatus.
          // We return an object that supports both possibilities — only one path is
          // actually walked per call.
          return {
            eq: (column: string) => {
              if (column === "id") return { maybeSingle }
              return { order }
            },
          }
        }),
      }
    })

    return { from, selectById, eqById, maybeSingle, selectRecent, eqStatus, order, limit }
  }

  it("returns the row matching an explicit blogPostId", async () => {
    const target: BlogTopic = {
      id: "abc",
      title: "Deload weeks",
      slug: "deload-weeks",
      excerpt: null,
      content: "body",
    }
    const fake = mockSupabase({ byId: target })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from }, blogPostId: "abc" })
    expect(result).toEqual(target)
  })

  it("returns the most recent published post when no blogPostId is given", async () => {
    const newest: BlogTopic = {
      id: "n",
      title: "Newest",
      slug: "newest",
      excerpt: null,
      content: null,
    }
    const fake = mockSupabase({ recent: [newest] })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from } })
    expect(result).toEqual(newest)
  })

  it("returns null when there are no published posts", async () => {
    const fake = mockSupabase({ recent: [] })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from } })
    expect(result).toBeNull()
  })

})

describe("Tavily trending topics", () => {
  function mockContentCalendarSupabase(rows: TavilyTopicRow[]) {
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const gte = vi.fn().mockReturnValue({ order })
    const eq = vi.fn().mockReturnValue({ gte })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn((table: string) => {
      if (table !== "content_calendar") throw new Error(`unexpected table ${table}`)
      return { select }
    })
    return { from, select, eq, gte, order, limit }
  }

  it("latestTavilyTopics filters out non-tavily rows and respects limit", async () => {
    const rows: TavilyTopicRow[] = [
      {
        id: "1",
        title: "Tavily 1",
        metadata: { source: "tavily", rank: 1, tavily_url: "https://a", summary: "" },
        created_at: "2026-05-12T00:00:00Z",
      },
      {
        id: "2",
        title: "Manual entry",
        metadata: { source: "manual" },
        created_at: "2026-05-11T00:00:00Z",
      },
      {
        id: "3",
        title: "Tavily 2",
        metadata: { source: "tavily", rank: 2 },
        created_at: "2026-05-10T00:00:00Z",
      },
      {
        id: "4",
        title: "Tavily 3",
        metadata: { source: "tavily", rank: 3 },
        created_at: "2026-05-09T00:00:00Z",
      },
    ]
    const fake = mockContentCalendarSupabase(rows)
    // @ts-expect-error: minimal SupabaseClient mock.
    const out = await latestTavilyTopics({ from: fake.from }, 2, 7)
    expect(out.map((r) => r.id)).toEqual(["1", "3"])
    expect(fake.eq).toHaveBeenCalledWith("entry_type", "topic_suggestion")
    expect(fake.limit).toHaveBeenCalledWith(6) // limit * 3 overfetch
  })

  it("latestTavilyTopics returns empty when supabase returns no data", async () => {
    const fake = mockContentCalendarSupabase([])
    // @ts-expect-error: minimal SupabaseClient mock.
    const out = await latestTavilyTopics({ from: fake.from }, 5, 7)
    expect(out).toEqual([])
  })

  it("buildTrendingBlock renders header, numbered topics, and gap-flag hint", () => {
    const block = buildTrendingBlock([
      {
        id: "1",
        title: "Hamstring rehab returns",
        metadata: {
          source: "tavily",
          rank: 1,
          tavily_url: "https://example.com/x",
          summary: "summary",
        },
        created_at: "2026-05-12T00:00:00Z",
      },
      {
        id: "2",
        title: "Velocity-based training resurges",
        metadata: { source: "tavily", rank: 2 },
        created_at: "2026-05-11T00:00:00Z",
      },
    ])
    expect(block).toContain("Trending topics this week")
    expect(block).toContain("Hamstring rehab returns")
    expect(block).toContain("Velocity-based training resurges")
    expect(block).toContain("relevance rank 1")
    expect(block).toContain("(https://example.com/x)")
    expect(block).toContain("flag_trending_gap")
  })

  it("buildTrendingBlock returns empty string when no topics", () => {
    expect(buildTrendingBlock([])).toBe("")
  })

  it("buildTrendingBlock falls back to index rank when metadata.rank is missing", () => {
    const block = buildTrendingBlock([
      {
        id: "1",
        title: "Topic without rank",
        metadata: { source: "tavily" },
        created_at: "2026-05-12T00:00:00Z",
      },
    ])
    expect(block).toContain("relevance rank 1")
  })
})

describe("pickTopicWithBrief fallback (separated)", () => {
  it("pickTopicWithBrief falls back to most-recent when no approved brief exists", async () => {
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "strategy_briefs") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === "blog_posts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [{ id: "b1", title: "T", slug: "t", excerpt: null, content: null }],
              error: null,
            }),
          }
        }
        return {}
      }),
    } as never
    const { topic, brief, alignmentScore } = await pickTopicWithBrief({ supabase })
    expect(topic?.id).toBe("b1")
    expect(brief).toBeNull()
    expect(alignmentScore).toBeNull()
  })
})
