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

describe("gatherCount28dDates", () => {
  it("returns the count of distinct dates in the 28d window", async () => {
    const { gatherCount28dDates } = await loadSignals()
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
    expect(await gatherCount28dDates(supabase)).toBe(2)
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
    })
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
})
