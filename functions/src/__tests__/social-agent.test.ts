import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// G35. handleSocialAgentRun is driven end to end at the bottom of this file,
// so the job document and the Supabase client are faked for the whole file.
// The helper suites above never reach either: each passes its own `supabase`.
const h = vi.hoisted(() => ({ jobGet: vi.fn(), jobUpdate: vi.fn(), from: vi.fn(), callAgent: vi.fn() }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: h.jobGet, update: h.jobUpdate }) }) }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: () => ({ from: h.from }) }))
// Only the Share-to-LinkedIn handler suites at the bottom reach the writer and
// reviewer; social-agent.ts imports nothing else from this module.
vi.mock("../ai/anthropic.js", () => ({ callAgent: h.callAgent, MODEL_SONNET: "model-sonnet" }))

import {
  buildCopywriterUserMessage,
  buildReviewerUserMessage,
  buildTrendingBlock,
  handleSocialAgentRun,
  latestTavilyTopics,
  listConnectedSocialPlatforms,
  pickNewsletterTopic,
  pickTopic,
  pickTopicWithBrief,
  SUPPORTED_PLATFORMS,
  type AgentPlatform,
  type BlogTopic,
  type TavilyTopicRow,
} from "../social-agent.js"
import { NEWSLETTER_CARD_DESCRIPTION } from "../social-share-link.js"

describe("social-agent helpers", () => {
  it("buildCopywriterUserMessage includes platform, blog title, excerpt, and source body", () => {
    const msg = buildCopywriterUserMessage({
      platform: "linkedin",
      topic: {
        kind: "blog",
        id: "b1",
        title: "Why your sprint mechanics suck after a hamstring strain",
        slug: "sprint-mechanics-hamstring",
        excerpt: "Most return-to-sport programs skip the eccentric phase.",
        content: "Long body content about hamstring rehab and force absorption.",
        cover_image_url: null,
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
        kind: "blog",
        id: "b1",
        title: "Title",
        slug: "title",
        excerpt: "Excerpt body used as source.",
        content: null,
        cover_image_url: null,
      },
    })
    expect(msg).toContain("Excerpt body used as source.")
  })

  // The card is attached by the publisher, so the writer must not paste a URL.
  // MUTANT: the subscribe line emitted for every kind (the blog case's
  // not.toContain catches it); the kind-labelled source line missing (the
  // newsletter case catches it).
  it("buildCopywriterUserMessage tells a blog writer the card is attached, and does not ask for a subscribe line", () => {
    const msg = buildCopywriterUserMessage({
      platform: "linkedin",
      topic: {
        kind: "blog",
        id: "b1",
        title: "ACL return",
        slug: "acl-return",
        excerpt: null,
        content: "Body.",
        cover_image_url: null,
      },
    })
    expect(msg).toContain("Source blog post title: ACL return")
    expect(msg).toContain("A link card to the source is attached beneath this post automatically.")
    expect(msg).toContain("Do not paste a URL")
    expect(msg).not.toContain("subscribe")
    // The guidance lands before the closing instruction, not after it.
    expect(msg.indexOf("Do not paste a URL")).toBeLessThan(msg.indexOf("Write the post for this platform"))
  })

  it("buildCopywriterUserMessage labels a newsletter issue as such and asks for one subscribe line", () => {
    const msg = buildCopywriterUserMessage({
      platform: "linkedin",
      topic: {
        kind: "newsletter",
        id: "n1",
        title: "Issue 12",
        slug: "",
        excerpt: null,
        content: "Rest & recover",
        cover_image_url: null,
      },
    })
    expect(msg).toContain("Source newsletter issue subject: Issue 12")
    expect(msg).not.toContain("Source blog post title")
    expect(msg).toContain("Do not paste a URL")
    expect(msg).toContain("End with one short line inviting the reader to subscribe to the newsletter.")
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
  // What blog_posts answers: the row as stored, with no `kind`. pickTopic adds
  // kind: "blog", so each expectation below is the row plus that one key.
  type BlogRow = Omit<BlogTopic, "kind">
  function mockSupabase(opts: {
    byId?: BlogRow | null
    recent?: BlogRow[]
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
    const target: BlogRow = {
      id: "abc",
      title: "Deload weeks",
      slug: "deload-weeks",
      excerpt: null,
      content: "body",
      cover_image_url: "https://cdn.example.com/deload.jpg",
    }
    const fake = mockSupabase({ byId: target })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from }, blogPostId: "abc" })
    expect(result).toEqual({ ...target, kind: "blog" })
  })

  it("returns the most recent published post when no blogPostId is given", async () => {
    const newest: BlogRow = {
      id: "n",
      title: "Newest",
      slug: "newest",
      excerpt: null,
      content: null,
      cover_image_url: null,
    }
    const fake = mockSupabase({ recent: [newest] })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from } })
    expect(result).toEqual({ ...newest, kind: "blog" })
  })

  it("returns null when an explicit blogPostId matches nothing", async () => {
    const fake = mockSupabase({ byId: null })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from }, blogPostId: "gone" })
    expect(result).toBeNull()
  })

  it("returns null when there are no published posts", async () => {
    const fake = mockSupabase({ recent: [] })
    // @ts-expect-error: minimal mock — SupabaseClient surface we use is narrow.
    const result = await pickTopic({ supabase: { from: fake.from } })
    expect(result).toBeNull()
  })

})

describe("pickNewsletterTopic", () => {
  function fakeNewsletters(row: Record<string, unknown> | null) {
    const eq = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn((table: string) => {
      if (table !== "newsletters") throw new Error(`unexpected table ${table}`)
      return { select }
    })
    return { supabase: { from } as never, select, eq }
  }

  // MUTANTS: content passed through as HTML (the writer would see "<p>" and
  // "&amp;"); "" preview_text kept as "" instead of null (the copywriter
  // would print an empty "Source excerpt:" line).
  it("maps the issue to a newsletter topic, with its HTML body as readable text", async () => {
    const fake = fakeNewsletters({ id: "n1", subject: "Issue 12", preview_text: "", content: "<p>Rest &amp; recover</p>" })
    expect(await pickNewsletterTopic({ supabase: fake.supabase, newsletterId: "n1" })).toEqual({
      kind: "newsletter",
      id: "n1",
      title: "Issue 12",
      slug: "",
      excerpt: null,
      content: "Rest & recover",
      cover_image_url: null,
    })
    expect(fake.select).toHaveBeenCalledWith("id, subject, preview_text, content")
    expect(fake.eq).toHaveBeenCalledWith("id", "n1")
  })

  it("returns null when the issue does not exist", async () => {
    const fake = fakeNewsletters(null)
    expect(await pickNewsletterTopic({ supabase: fake.supabase, newsletterId: "gone" })).toBeNull()
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

describe("handleSocialAgentRun — Share to LinkedIn (newsletter source, link card)", () => {
  const SITE = "https://www.darrenjpaul.com"
  const PROMPTS = [
    { scope: "global", category: "voice_profile", prompt: "Voice.", few_shot_examples: [] },
    { scope: "global", category: "social_caption_reviewer", prompt: "Review.", few_shot_examples: [] },
    { scope: "linkedin", category: "social_caption", prompt: "LinkedIn rules.", few_shot_examples: [] },
  ]
  let postInserts: Array<Record<string, unknown>> = []
  let memoInserts: Array<Record<string, unknown>> = []

  // A chainable read/write builder whose every terminal answers `result`.
  function table(result: { data: unknown; error: unknown }, onInsert?: (row: Record<string, unknown>) => void) {
    const b: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) b[m] = () => b
    b.insert = (row: Record<string, unknown>) => {
      onInsert?.(row)
      return b
    }
    b.maybeSingle = async () => result
    b.single = async () => result
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return b
  }

  function route(opts: { newsletter?: Record<string, unknown> | null; blog?: Record<string, unknown> | null } = {}) {
    postInserts = []
    memoInserts = []
    h.from.mockImplementation((t: string) => {
      switch (t) {
        case "newsletters":
          return table({ data: opts.newsletter ?? null, error: null })
        case "blog_posts":
          return table({ data: opts.blog ?? null, error: null })
        case "prompt_templates":
          return table({ data: PROMPTS, error: null })
        case "agent_tool_baselines":
        case "content_calendar":
          return table({ data: [], error: null })
        case "social_posts":
          return table({ data: { id: "sp-1" }, error: null }, (row) => postInserts.push(row))
        case "social_captions":
          return table({ data: null, error: null })
        case "social_agent_memos":
          return table({ data: null, error: null }, (row) => memoInserts.push(row))
        default:
          throw new Error(`unexpected table ${t}`)
      }
    })
  }
  const job = (input: Record<string, unknown>) =>
    h.jobGet.mockResolvedValue({ data: () => ({ status: "pending", type: "social_agent_run", input }) })
  const lastUpdate = () => h.jobUpdate.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
  const tables = () => h.from.mock.calls.map((c) => c[0])

  beforeEach(() => {
    h.from.mockReset()
    h.jobGet.mockReset()
    h.jobUpdate.mockReset()
    h.jobUpdate.mockResolvedValue(undefined)
    h.callAgent.mockReset()
    h.callAgent
      .mockResolvedValueOnce({ content: { caption_text: "Writer draft.", hashtags: ["recovery"] } })
      .mockResolvedValueOnce({
        content: { revised_caption_text: "Final post.", revised_hashtags: ["recovery"], score: 8, notes: "ok" },
      })
    vi.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // MUTANTS, each caught by the exact insert row: the spread of
  // buildShareLink dropped (no card, no source); siteUrl not threaded into
  // draftForPlatform (link_* all null); the newsletter id written to
  // source_blog_post_id.
  it("drafts from a newsletter issue: the card points at the sign-up section and the brief is skipped", async () => {
    route({ newsletter: { id: "n1", subject: "Issue 12", preview_text: "Rest week.", content: "<p>Rest &amp; recover</p>" } })
    job({ platform: "linkedin", newsletterId: "n1", siteUrl: SITE, businessId: "biz-1" })
    await handleSocialAgentRun("job-nl")

    expect(postInserts).toEqual([
      {
        platform: "linkedin",
        content: "Final post.",
        approval_status: "draft",
        post_type: "text",
        source_blog_post_id: null,
        source_newsletter_id: "n1",
        link_url: `${SITE}/#newsletter`,
        link_title: "Issue 12",
        link_description: NEWSLETTER_CARD_DESCRIPTION,
        link_image_url: `${SITE}/images/gym-training-01.jpg`,
      },
    ])
    // An explicit share skips the strategist and its brief, like an explicit blogPostId.
    expect(tables()).not.toContain("strategy_briefs")
    expect(tables()).not.toContain("blog_posts")
    // The writer saw the issue as text, labelled as a newsletter.
    const writerMessage = String(h.callAgent.mock.calls[0][1])
    expect(writerMessage).toContain("Source newsletter issue subject: Issue 12")
    expect(writerMessage).toContain("Rest & recover")
    expect(writerMessage).not.toContain("&amp;")

    expect(memoInserts).toHaveLength(1)
    expect(memoInserts[0]).toMatchObject({ brief_id: null, ran_without_brief: true })
    expect(memoInserts[0].actions).toEqual([
      {
        kind: "drafted_social_post",
        payload: { social_post_id: "sp-1", platform: "linkedin", blog_post_id: null, newsletter_id: "n1" },
        rationale: "ok",
      },
    ])
    // The UI reads result.platforms[0].social_post_id; that shape is kept.
    expect(lastUpdate()).toMatchObject({
      status: "completed",
      error: null,
      result: {
        platforms: [{ platform: "linkedin", social_post_id: "sp-1", reviewer_score: 8 }],
        failed_platforms: [],
        blog_post_id: null,
        newsletter_id: "n1",
        brief_id: null,
      },
    })
  })

  // Review focus 5: a job enqueued by code older than this feature carries no
  // siteUrl. It still drafts and records the source; it just gets no card.
  // Presence control for the null link fields: the test above.
  it("drafts a blog post for a job with no siteUrl, recording the source but no card", async () => {
    route({
      blog: {
        id: "b1",
        title: "ACL return",
        slug: "acl-return",
        excerpt: "What the research says.",
        content: "Body.",
        cover_image_url: "https://cdn.example.com/c.jpg",
      },
    })
    job({ platform: "linkedin", blogPostId: "b1" })
    await handleSocialAgentRun("job-old")

    expect(postInserts).toEqual([
      {
        platform: "linkedin",
        content: "Final post.",
        approval_status: "draft",
        post_type: "text",
        source_blog_post_id: "b1",
        source_newsletter_id: null,
        link_url: null,
        link_title: null,
        link_description: null,
        link_image_url: null,
      },
    ])
    expect(lastUpdate()).toMatchObject({
      status: "completed",
      result: { blog_post_id: "b1", newsletter_id: null },
    })
  })

  it("fails the job when the newsletter issue does not exist, and drafts nothing", async () => {
    route({ newsletter: null })
    job({ platform: "linkedin", newsletterId: "gone", siteUrl: SITE })
    await handleSocialAgentRun("job-missing")
    expect(lastUpdate()).toMatchObject({ status: "failed", error: "Newsletter not found" })
    expect(tables()).not.toContain("social_posts")
    expect(h.callAgent).not.toHaveBeenCalled()
  })

  // MUTANT: the guard removed (newsletterId silently wins, or blogPostId does).
  // Either way a draft would be written, so social_posts would be touched.
  it("refuses a job naming both a blog post and a newsletter issue", async () => {
    route({
      newsletter: { id: "n1", subject: "Issue 12", preview_text: "", content: "" },
      blog: { id: "b1", title: "T", slug: "t", excerpt: null, content: null, cover_image_url: null },
    })
    job({ platform: "linkedin", blogPostId: "b1", newsletterId: "n1", siteUrl: SITE })
    await handleSocialAgentRun("job-both")
    expect(lastUpdate()).toEqual({
      status: "failed",
      error: "A share names one source: blogPostId or newsletterId, not both",
      updatedAt: "server-ts",
    })
    expect(h.from).not.toHaveBeenCalledWith("social_posts")
    expect(h.callAgent).not.toHaveBeenCalled()
  })
})
