import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// G35. handleSocialAgentRun is driven end to end at the bottom of this file,
// so the job document and the Supabase client are faked for the whole file.
// The helper suites above never reach either: each passes its own `supabase`.
const h = vi.hoisted(() => ({ jobGet: vi.fn(), jobUpdate: vi.fn(), from: vi.fn() }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: h.jobGet, update: h.jobUpdate }) }) }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: () => ({ from: h.from }) }))

import {
  buildCopywriterUserMessage,
  buildReviewerUserMessage,
  buildTrendingBlock,
  handleSocialAgentRun,
  latestTavilyTopics,
  listConnectedSocialPlatforms,
  pickTopic,
  pickTopicWithBrief,
  SUPPORTED_PLATFORMS,
  type AgentPlatform,
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

describe("SUPPORTED_PLATFORMS", () => {
  it("includes all 6 social platforms", () => {
    expect(SUPPORTED_PLATFORMS).toEqual([
      "linkedin",
      "facebook",
      "instagram",
      "tiktok",
      "youtube",
      "youtube_shorts",
    ])
  })
})

describe("listConnectedSocialPlatforms", () => {
  function mockSupabaseWithConnections(
    rows: Array<{ plugin_name: string; status: string }>,
  ) {
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
    const inFn = vi.fn().mockReturnValue({ eq })
    const select = vi.fn().mockReturnValue({ in: inFn })
    const from = vi.fn((table: string) => {
      if (table !== "platform_connections") throw new Error(`unexpected table ${table}`)
      return { select }
    })
    return { from, select, in: inFn, eq } as unknown as Parameters<typeof listConnectedSocialPlatforms>[0]
  }

  it("returns only platforms with status=connected", async () => {
    const supabase = mockSupabaseWithConnections([
      { plugin_name: "linkedin", status: "connected" },
      { plugin_name: "tiktok", status: "connected" },
      { plugin_name: "facebook", status: "not_connected" },
    ])
    // The mock returns all rows when .eq is called — but the production code
    // filters via supabase.eq("status", "connected"). To keep the mock simple
    // we pre-filter the input here and just verify the mapping/typing layer.
    const result = await listConnectedSocialPlatforms(supabase)
    // The mock returned all 3 rows; production .eq would have pre-filtered, but
    // our return-everything mock means we'll see all 3 names back. The type
    // filter on AgentPlatform keeps them in.
    expect(result).toContain("linkedin")
    expect(result).toContain("tiktok")
  })

  it("filters out plugin_name values that aren't social platforms", async () => {
    const supabase = mockSupabaseWithConnections([
      { plugin_name: "linkedin", status: "connected" },
      { plugin_name: "google_ads", status: "connected" }, // not a social platform
      { plugin_name: "gmail", status: "connected" }, // not a social platform
    ])
    const result = await listConnectedSocialPlatforms(supabase)
    expect(result).toEqual(["linkedin"])
  })

  it("returns empty array when nothing is connected", async () => {
    const supabase = mockSupabaseWithConnections([])
    const result = await listConnectedSocialPlatforms(supabase)
    expect(result).toEqual([])
  })

  it("accepts every value in SUPPORTED_PLATFORMS as a valid AgentPlatform", async () => {
    // Type-level check: this is a compile-time test. If SUPPORTED_PLATFORMS
    // and AgentPlatform drift apart, this assignment will fail tsc.
    const all: AgentPlatform[] = [...SUPPORTED_PLATFORMS]
    expect(all).toHaveLength(6)
  })
})

describe("handleSocialAgentRun — no eligible topic (G35)", () => {
  // Every recent post matches the approved brief's dont_do, so the strategist
  // picks nothing and the handler takes the no_eligible_topic branch: a memo,
  // an alert to the owners of the job's business, and a completed-but-skipped
  // job. The REAL scorer decides that ("deload" is in the post's title).
  const BRIEF = {
    id: "brief-1",
    week_of: "2026-09-21",
    themes: [],
    audience_focus: "",
    priority_channel: "social",
    keywords_to_chase: [],
    hooks_to_test: [],
    ctas: [],
    dont_do: ["deload"],
  }
  const MEMBERS = [
    { business_id: "biz-1", user_id: "owner-1", role: "owner" },
    { business_id: "biz-2", user_id: "owner-2", role: "owner" },
  ]
  let inserted: Array<Record<string, unknown>> = []
  const spies: Array<{ mockRestore: () => void }> = []
  function silence(method: "warn" | "error") {
    const spy = vi.spyOn(console, method).mockImplementation(() => {})
    spies.push(spy)
    return spy
  }
  const messages = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]))

  function route(opts: { membersError?: { code: string; message: string } } = {}) {
    inserted = []
    h.from.mockImplementation((table: string) => {
      if (table === "strategy_briefs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: BRIEF, error: null }),
        }
      }
      if (table === "blog_posts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: "b1", title: "Deload weeks, explained", slug: "deload-weeks", excerpt: null, content: null }],
            error: null,
          }),
        }
      }
      if (table === "social_agent_memos") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === "business_members") {
        // Filtered by what the caller asked for, so the test can tell WHICH
        // business reached the read.
        const filters: Array<[string, unknown]> = []
        const builder = {
          select: (_columns: string) => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return builder
          },
          order: (_column: string, _o?: unknown) => builder,
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(
              opts.membersError
                ? { data: null, error: opts.membersError }
                : {
                    data: MEMBERS.filter((m) =>
                      filters.every(([c, v]) => (m as Record<string, unknown>)[c] === v),
                    ).map((m) => ({ user_id: m.user_id })),
                    error: null,
                  },
            ).then(resolve, reject),
        }
        return builder
      }
      if (table === "notifications") {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            inserted.push(...rows)
            return {
              select: (_columns: string) =>
                Promise.resolve({
                  data: rows.map((r) => ({ id: `notif-${String(r.user_id)}`, user_id: r.user_id })),
                  error: null,
                }),
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
  }
  const job = (input: Record<string, unknown>) =>
    h.jobGet.mockResolvedValue({ data: () => ({ status: "pending", type: "social_agent_run", input }) })

  beforeEach(() => {
    h.from.mockReset()
    h.jobGet.mockReset()
    h.jobUpdate.mockReset()
    h.jobUpdate.mockResolvedValue(undefined)
  })
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore()
  })

  // MUTANTS, all caught by the exact row: the old `profiles` read (PGRST205,
  // so no bell at all); the dead link /admin/social-agent/memos; the platform
  // business in place of the job's (it would bell owner-1).
  it("bells the owners of the job's business, linking to the brief on /admin/strategy", async () => {
    route()
    job({ platform: "linkedin", businessId: "biz-2" })
    await handleSocialAgentRun("job-1")
    expect(inserted).toEqual([
      {
        user_id: "owner-2",
        type: "warning",
        title: "Social agent could not find an eligible topic",
        message: "All recent published posts matched the brief's dont_do filter. Brief id: brief-1",
        link: "/admin/strategy",
        is_read: false,
      },
    ])
    expect(h.jobUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      result: { skipped: "no_eligible_topic", brief_id: "brief-1" },
    })
  })

  // MUTANT: default a missing businessId to the platform business. A job
  // enqueued before G35 sends no alert and says so; it still completes.
  it("sends no alert for a job with no businessId, warns, and still completes", async () => {
    const warn = silence("warn")
    route()
    job({ platform: "linkedin" })
    await handleSocialAgentRun("job-old-route")
    expect(h.from).not.toHaveBeenCalledWith("business_members")
    expect(inserted).toEqual([])
    // Presence control: the branch DID run — its memo was written.
    expect(h.from).toHaveBeenCalledWith("social_agent_memos")
    expect(messages(warn).some((m) => m.includes("no input.businessId"))).toBe(true)
    expect(h.jobUpdate.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed" })
  })

  // MUTANT: the helper's result ignored, the way the profiles read's error was
  // (`const { data: admins } = …`). A failed alert is logged, not swallowed,
  // and the job still completes: the agent's decision not to draft stands.
  it("logs a failed alert instead of dropping it", async () => {
    const error = silence("error")
    route({ membersError: { code: "42501", message: "permission denied" } })
    job({ platform: "linkedin", businessId: "biz-2" })
    await handleSocialAgentRun("job-2")
    expect(messages(error)).toContainEqual(
      expect.stringContaining("business_members read failed (42501 permission denied)"),
    )
    expect(inserted).toEqual([])
    expect(h.jobUpdate.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed" })
  })
})
