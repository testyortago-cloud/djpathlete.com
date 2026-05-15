import { describe, expect, it, vi, beforeEach } from "vitest"

const gatherSeoSignalsMock = vi.fn()
const reasonAboutWeekMock = vi.fn()
const executeActionMock = vi.fn()
const supabaseFromMock = vi.fn()
const jobRefGet = vi.fn()
const jobRefUpdate = vi.fn()

vi.mock("../seo/signals.js", () => ({ gatherSeoSignals: gatherSeoSignalsMock }))
vi.mock("../seo/reason.js", () => ({ reasonAboutWeek: reasonAboutWeekMock }))
vi.mock("../seo/execute.js", () => ({ executeAction: executeActionMock }))
vi.mock("../lib/supabase.js", () => ({ getSupabase: () => ({ from: supabaseFromMock }) }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: jobRefGet, update: jobRefUpdate }) }),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  gatherSeoSignalsMock.mockReset()
  reasonAboutWeekMock.mockReset()
  executeActionMock.mockReset()
  supabaseFromMock.mockReset()
  jobRefGet.mockReset()
  jobRefUpdate.mockReset()
})

describe("handleSeoAgent", () => {
  it("happy path: gather, reason, execute 2 actions, insert memo, mark job completed", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "admin-uuid" } }),
    })
    gatherSeoSignalsMock.mockResolvedValueOnce({
      gsc_28d: { total_clicks: 100, total_impressions: 1000, avg_position: 12, top_winnable: [], top_decayed: [] },
      inventory: { total_posts: 50, oldest_post_age_days: 600, never_refreshed_count: 40 },
      recent_tavily: [],
      orphan_post_ids: [],
      last_8_memos_outcomes: [],
      gsc_distinct_dates: 28,
      brief_context: null,
      tool_performance: [],
    })
    reasonAboutWeekMock.mockResolvedValueOnce({
      decision: {
        rationale: "Striking-distance keyword + decay refresh — diverse and measurable",
        actions: [
          { rank: 1, tool: "queue_new_post", args: { keyword: "deadlift", angle: "bio" } },
          { rank: 2, tool: "queue_refresh", args: { blog_post_id: "11111111-1111-1111-1111-111111111111", reason: "decay" } },
        ],
        brief_alignment_score: null,
        agent_confidence: 7,
        dissent_from_upstream: { dissents: false, reason: null },
      },
      tokens_used: 500,
    })
    executeActionMock
      .mockResolvedValueOnce({ executed: true, execution_target_id: "cc-1" })
      .mockResolvedValueOnce({ executed: true, execution_target_id: "ai-1" })

    // Memo insert returns id.
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "seo_agent_memos") {
        return {
          insert: () => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: "memo-1" }, error: null }) }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      return {}
    })

    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("job-1")

    expect(executeActionMock).toHaveBeenCalledTimes(2)
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { memoId: string }).memoId).toBe("memo-1")
  })

  it("skips silently when gsc_query_daily has fewer than 28 distinct dates", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "u" } }),
    })
    gatherSeoSignalsMock.mockResolvedValueOnce({
      gsc_28d: { total_clicks: 0, total_impressions: 0, avg_position: 0, top_winnable: [], top_decayed: [] },
      inventory: { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 },
      recent_tavily: [],
      orphan_post_ids: [],
      last_8_memos_outcomes: [],
      gsc_distinct_dates: 5,
      brief_context: null,
      tool_performance: [],
    })

    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("job-2")

    expect(reasonAboutWeekMock).not.toHaveBeenCalled()
    expect(executeActionMock).not.toHaveBeenCalled()
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { skipped: string }).skipped).toMatch(/warm.?up/i)
  })

  it("marks job failed when reasoning throws", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "u" } }),
    })
    gatherSeoSignalsMock.mockResolvedValueOnce({
      gsc_28d: { total_clicks: 0, total_impressions: 0, avg_position: 0, top_winnable: [], top_decayed: [] },
      inventory: { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 },
      recent_tavily: [],
      orphan_post_ids: [],
      last_8_memos_outcomes: [],
      gsc_distinct_dates: 30,
      brief_context: null,
      tool_performance: [],
    })
    reasonAboutWeekMock.mockRejectedValueOnce(new Error("Claude API timeout"))

    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("job-3")

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; error?: string }
    expect(finalUpdate?.status).toBe("failed")
    expect(finalUpdate?.error).toMatch(/Claude API timeout/)
  })

  it("bails when job doc is not pending", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "completed", type: "seo_agent_run", input: {} }),
    })
    const { handleSeoAgent } = await import("../seo-agent.js")
    await handleSeoAgent("done-job")
    expect(gatherSeoSignalsMock).not.toHaveBeenCalled()
  })
})
