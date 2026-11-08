import { describe, expect, it, vi } from "vitest"

// Helper that mirrors the project pattern for Supabase mocks:
// `chains` is keyed by table name and returns the chainable mock.
function buildSupabase(chains: Record<string, unknown>): unknown {
  return {
    from: vi.fn((table: string) => chains[table] ?? {}),
  }
}

async function loadSignals() {
  return import("../seo/signals.js")
}

describe("gatherWarmUpDateCount", () => {
  it("returns the count of distinct dates in the window", async () => {
    const { gatherWarmUpDateCount } = await loadSignals()
    const supabase = buildSupabase({
      gsc_query_daily: {
        select: () => ({
          gte: () =>
            Promise.resolve({
              data: [{ date: "2026-05-12" }, { date: "2026-05-12" }, { date: "2026-05-11" }],
              error: null,
            }),
        }),
      },
    }) as never
    expect(await gatherWarmUpDateCount(supabase)).toBe(2)
  })

  // GSC lags 2-3 days. A window of 28 days held at most 27 dates, so the
  // 28-date warm-up gate skipped every weekly run (2026-06-14 to 2026-11-01).
  it("looks back far enough that 28 dates fit despite GSC's 3-day lag", async () => {
    const { gatherWarmUpDateCount } = await loadSignals()
    let since = ""
    const supabase = buildSupabase({
      gsc_query_daily: {
        select: () => ({
          gte: (_col: string, value: string) => {
            since = value
            return Promise.resolve({ data: [], error: null })
          },
        }),
      },
    }) as never
    await gatherWarmUpDateCount(supabase)
    const daysBack = Math.round((Date.now() - Date.parse(`${since}T00:00:00Z`)) / 86_400_000)
    expect(daysBack).toBeGreaterThanOrEqual(28 + 3)
  })
})

describe("gatherInventorySignals", () => {
  it("computes totals, oldest age, never-refreshed count", async () => {
    const { gatherInventorySignals } = await loadSignals()
    const longAgo = new Date(Date.now() - 1000 * 86400 * 1000).toISOString()
    const supabase = buildSupabase({
      blog_posts: {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { id: "a", published_at: longAgo, last_refreshed_at: null },
                { id: "b", published_at: new Date().toISOString(), last_refreshed_at: new Date().toISOString() },
              ],
              error: null,
            }),
        }),
      },
    }) as never
    const out = await gatherInventorySignals(supabase)
    expect(out.total_posts).toBe(2)
    expect(out.never_refreshed_count).toBe(1)
    expect(out.oldest_post_age_days).toBeGreaterThan(900)
  })

  it("returns zeros when no published posts", async () => {
    const { gatherInventorySignals } = await loadSignals()
    const supabase = buildSupabase({
      blog_posts: { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) },
    }) as never
    expect(await gatherInventorySignals(supabase)).toEqual({
      total_posts: 0,
      oldest_post_age_days: 0,
      never_refreshed_count: 0,
      posts: [],
    })
  })

  // MUTANT: select without title/slug, or drop `posts`. The agent then sees counts only and picks
  // link-sweep anchors blind (two 2026-11-08 sweeps added 0 links).
  it("lists the posts with their titles, newest first", async () => {
    const { gatherInventorySignals } = await loadSignals()
    let columns = ""
    const supabase = buildSupabase({
      blog_posts: {
        select: (cols: string) => {
          columns = cols
          return {
            eq: () =>
              Promise.resolve({
                data: [
                  { id: "old", title: "Hamstring Injuries", slug: "hamstring", published_at: "2026-09-01T00:00:00Z", last_refreshed_at: null },
                  { id: "new", title: "Change of Direction", slug: "cod", published_at: "2026-09-05T00:00:00Z", last_refreshed_at: null },
                ],
                error: null,
              }),
          }
        },
      },
    }) as never
    const out = await gatherInventorySignals(supabase)
    expect(columns).toMatch(/\btitle\b/)
    expect(columns).toMatch(/\bslug\b/)
    expect(out.posts).toEqual([
      { id: "new", title: "Change of Direction", slug: "cod" },
      { id: "old", title: "Hamstring Injuries", slug: "hamstring" },
    ])
  })
})

describe("gatherGscSignals", () => {
  // MUTANT: drop ranking_page. The agent then asks the coach which post owns a search (the
  // 2026-11-08 flag) instead of reading it.
  it("names the page Google shows most for each winnable query, as a path", async () => {
    const { gatherGscSignals } = await loadSignals()
    const recent = [
      { query: "beginner running training", page: "https://www.darrenjpaul.com/blog/hamstring", impressions: 50, clicks: 0, position: 10, date: "2026-11-01" },
      { query: "beginner running training", page: "https://www.darrenjpaul.com/blog/cod", impressions: 14, clicks: 0, position: 11, date: "2026-11-02" },
    ]
    const supabase = buildSupabase({
      gsc_query_daily: {
        select: () => ({
          gte: () => Object.assign(Promise.resolve({ data: recent, error: null }), { lt: () => Promise.resolve({ data: [], error: null }) }),
        }),
      },
    }) as never
    const out = await gatherGscSignals(supabase)
    expect(out.top_winnable).toHaveLength(1)
    expect(out.top_winnable[0]).toMatchObject({ query: "beginner running training", impressions_28d: 64, ranking_page: "/blog/hamstring" })
  })
})

describe("gatherOrphanPostIds", () => {
  it("flags posts whose slug is not referenced by other posts' content", async () => {
    const { gatherOrphanPostIds } = await loadSignals()
    const supabase = buildSupabase({
      blog_posts: {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "a", slug: "alpha", content: '<p>links to <a href="/blog/beta">beta</a></p>' },
                    { id: "b", slug: "beta", content: "<p>no inbound refs</p>" },
                    { id: "c", slug: "gamma", content: "<p>orphan with no inbound links</p>" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      },
    }) as never
    const orphans = await gatherOrphanPostIds(supabase)
    expect(orphans).toContain("a")
    expect(orphans).toContain("c")
    expect(orphans).not.toContain("b")
  })
})

describe("gatherTavilySignals", () => {
  it("excludes rows the agent itself wrote (source=seo_agent)", async () => {
    const { gatherTavilySignals } = await loadSignals()
    const supabase = buildSupabase({
      content_calendar: {
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      { title: "From Tavily", metadata: { source: "tavily", rank: 1 }, created_at: "2026-05-10" },
                      { title: "From agent", metadata: { source: "seo_agent", rank: 1 }, created_at: "2026-05-09" },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      },
    }) as never
    const out = await gatherTavilySignals(supabase)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("From Tavily")
  })
})

describe("gatherMemorySignals", () => {
  it("flattens last-8 memos into per-action records", async () => {
    const { gatherMemorySignals } = await loadSignals()
    const supabase = buildSupabase({
      seo_agent_memos: {
        select: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    run_date: "2026-05-05",
                    actions: [
                      { tool: "queue_refresh" },
                      { tool: "queue_new_post" },
                    ],
                    outcome_status: "measured",
                    outcome_metrics: [{ clicks_after: 31 }],
                  },
                ],
                error: null,
              }),
          }),
        }),
      },
    }) as never
    const out = await gatherMemorySignals(supabase)
    expect(out).toHaveLength(2)
    expect(out[0].tool).toBe("queue_refresh")
    expect(out[0].outcome_status).toBe("measured")
    expect(out[1].tool).toBe("queue_new_post")
  })

  // MUTANT: drop `target`. The agent then knows a sweep is pending but not for which post.
  it("says what each earlier action was aimed at", async () => {
    const { gatherMemorySignals } = await loadSignals()
    const supabase = buildSupabase({
      seo_agent_memos: {
        select: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    run_date: "2026-11-08",
                    actions: [
                      { tool: "queue_internal_link_sweep", args: { target_blog_post_id: "post-1", candidate_anchor_post_ids: ["post-2"] } },
                      { tool: "queue_new_post", args: { keyword: "beginner running training", angle: "a" } },
                      { tool: "flag_for_human", args: { issue: "i", context: "c", urgency: "low" } },
                    ],
                    outcome_status: "pending",
                    outcome_metrics: null,
                  },
                ],
                error: null,
              }),
          }),
        }),
      },
    }) as never
    const out = await gatherMemorySignals(supabase)
    expect(out.map((o) => o.target)).toEqual(["post-1", "beginner running training", undefined])
  })
})
