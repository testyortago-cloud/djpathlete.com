import { describe, expect, it, vi, beforeEach } from "vitest"

const gatherSeoSignalsMock = vi.fn()
const reasonAboutWeekMock = vi.fn()
const executeActionMock = vi.fn()
const supabaseFromMock = vi.fn()
const jobRefGet = vi.fn()
const jobRefUpdate = vi.fn()
const runSelfCritiqueMock = vi.fn()
const shouldReRunAfterCritiqueMock = vi.fn()

vi.mock("../seo/signals.js", () => ({ gatherSeoSignals: gatherSeoSignalsMock }))
vi.mock("../seo/reason.js", () => ({ reasonAboutWeek: reasonAboutWeekMock }))
vi.mock("../seo/execute.js", () => ({ executeAction: executeActionMock }))
vi.mock("../lib/supabase.js", () => ({ getSupabase: () => ({ from: supabaseFromMock }) }))
vi.mock("../lib/self-critique.js", () => ({
  runSelfCritique: runSelfCritiqueMock,
  shouldReRunAfterCritique: shouldReRunAfterCritiqueMock,
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: jobRefGet, update: jobRefUpdate }) }),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

// Default supabase router used by most tests. Honours system_settings flag fetch
// and seo_agent_memos insert/update. Override per-test via supabaseFromMock.mockImplementation.
function defaultSupabaseRouter(opts: {
  critiqueFlag?: { enabled?: boolean } | null
  memoInsertId?: string
  memoInsertError?: { message: string } | null
} = {}): (table: string) => unknown {
  const {
    critiqueFlag = { enabled: true },
    memoInsertId = "memo-1",
    memoInsertError = null,
  } = opts
  return (table: string) => {
    if (table === "system_settings") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: critiqueFlag === null ? null : { value: critiqueFlag }, error: null }),
          }),
        }),
      }
    }
    if (table === "seo_agent_memos") {
      return {
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve(
                memoInsertError
                  ? { data: null, error: memoInsertError }
                  : { data: { id: memoInsertId }, error: null },
              ),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    }
    if (table === "prompt_templates") {
      // Read by (scope, category) via readFewShots — return the carrier
      // row with an empty examples array so the agent still runs.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { few_shot_examples: [] }, error: null }),
            }),
          }),
        }),
      }
    }
    return {}
  }
}

beforeEach(() => {
  gatherSeoSignalsMock.mockReset()
  reasonAboutWeekMock.mockReset()
  executeActionMock.mockReset()
  supabaseFromMock.mockReset()
  jobRefGet.mockReset()
  jobRefUpdate.mockReset()
  runSelfCritiqueMock.mockReset()
  shouldReRunAfterCritiqueMock.mockReset()

  // Default: critique returns 'sound' and re-run heuristic returns false.
  runSelfCritiqueMock.mockResolvedValue({ overall: "sound", objections: [] })
  shouldReRunAfterCritiqueMock.mockReturnValue(false)
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

    supabaseFromMock.mockImplementation(defaultSupabaseRouter())

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
    supabaseFromMock.mockImplementation(defaultSupabaseRouter())

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

  describe("self-critique pass", () => {
    function setupRun(decision: {
      agent_confidence: number
      actions?: Array<{ rank: 1 | 2; tool: string; args: Record<string, unknown>; complementary_to_rank_1?: string }>
    }) {
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
      reasonAboutWeekMock.mockResolvedValueOnce({
        decision: {
          rationale: "v1 rationale",
          actions: decision.actions ?? [
            { rank: 1 as const, tool: "queue_new_post", args: { keyword: "k1" } },
            { rank: 2 as const, tool: "queue_refresh", args: { blog_post_id: "p1", reason: "decay" } },
          ],
          brief_alignment_score: null,
          agent_confidence: decision.agent_confidence,
          dissent_from_upstream: { dissents: false, reason: null },
        },
        tokens_used: 500,
      })
      executeActionMock
        .mockResolvedValueOnce({ executed: true, execution_target_id: "t1" })
        .mockResolvedValueOnce({ executed: true, execution_target_id: "t2" })
    }

    it("skips critique entirely when flag is disabled", async () => {
      setupRun({ agent_confidence: 5 })
      supabaseFromMock.mockImplementation(defaultSupabaseRouter({ critiqueFlag: { enabled: false } }))

      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-flag-off")

      expect(runSelfCritiqueMock).not.toHaveBeenCalled()
      expect(reasonAboutWeekMock).toHaveBeenCalledTimes(1)
    })

    it("runs critique but does NOT re-run when shouldReRun returns false", async () => {
      setupRun({ agent_confidence: 9 })
      runSelfCritiqueMock.mockResolvedValueOnce({
        overall: "minor_concern",
        objections: ["consider refresh decay window"],
      })
      shouldReRunAfterCritiqueMock.mockReturnValueOnce(false)

      const insertSpy = vi.fn((_row: Record<string, unknown>) => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "memo-x" }, error: null }) }),
      }))
      supabaseFromMock.mockImplementation((table: string) => {
        if (table === "system_settings") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { value: { enabled: true } }, error: null }) }),
            }),
          }
        }
        if (table === "seo_agent_memos") {
          return {
            insert: insertSpy,
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }
        }
        if (table === "prompt_templates") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { few_shot_examples: [] }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      })

      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-no-rerun")

      expect(runSelfCritiqueMock).toHaveBeenCalledTimes(1)
      expect(reasonAboutWeekMock).toHaveBeenCalledTimes(1) // no re-run
      const memoRow = insertSpy.mock.calls[0]?.[0] as unknown as { self_critique_notes?: string }
      expect(memoRow.self_critique_notes).toContain("[v1 critique]")
      expect(memoRow.self_critique_notes).toContain("overall=minor_concern")
      expect(memoRow.self_critique_notes).toContain("consider refresh decay window")
    })

    it("re-runs reason once when critique flags should_revise AND confidence <= 7; uses v2 plan", async () => {
      setupRun({ agent_confidence: 6 })
      runSelfCritiqueMock.mockResolvedValueOnce({
        overall: "should_revise",
        objections: ["queue_refresh has 30% historical success — bias away"],
      })
      shouldReRunAfterCritiqueMock.mockReturnValueOnce(true)
      // Second reasonAboutWeek call: revised plan
      reasonAboutWeekMock.mockResolvedValueOnce({
        decision: {
          rationale: "v2 rationale",
          actions: [
            { rank: 1 as const, tool: "queue_new_post", args: { keyword: "k2" } },
            { rank: 2 as const, tool: "queue_internal_link_sweep", args: { target_blog_post_id: "p2", candidate_anchor_post_ids: ["p3"] } },
          ],
          brief_alignment_score: null,
          agent_confidence: 8,
          dissent_from_upstream: { dissents: false, reason: null },
        },
        tokens_used: 600,
      })

      const insertSpy = vi.fn((_row: Record<string, unknown>) => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "memo-r" }, error: null }) }),
      }))
      supabaseFromMock.mockImplementation((table: string) => {
        if (table === "system_settings") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { value: { enabled: true } }, error: null }) }),
            }),
          }
        }
        if (table === "seo_agent_memos") {
          return {
            insert: insertSpy,
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }
        }
        if (table === "prompt_templates") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { few_shot_examples: [] }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      })

      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-rerun")

      expect(reasonAboutWeekMock).toHaveBeenCalledTimes(2)
      // Second call should pass the critique objections (alongside any
      // contextual extras like few_shots that the handler threads
      // through every reason call).
      const secondCallArgs = reasonAboutWeekMock.mock.calls[1]
      expect(secondCallArgs[1]).toMatchObject({
        critique_objections: ["queue_refresh has 30% historical success — bias away"],
      })

      const memoRow = insertSpy.mock.calls[0]?.[0] as unknown as {
        self_critique_notes?: string
        rationale: string
        actions: Array<{ tool: string }>
        agent_confidence: number
      }
      // v2 plan should be persisted
      expect(memoRow.rationale).toBe("v2 rationale")
      expect(memoRow.agent_confidence).toBe(8)
      expect(memoRow.actions.map((a) => a.tool)).toEqual(["queue_new_post", "queue_internal_link_sweep"])
      // critique notes should include all three blocks
      expect(memoRow.self_critique_notes).toContain("[v1 plan]")
      expect(memoRow.self_critique_notes).toContain("[critique]")
      expect(memoRow.self_critique_notes).toContain("[v2 plan]")
      expect(memoRow.self_critique_notes).toContain("queue_refresh") // v1
      expect(memoRow.self_critique_notes).toContain("queue_internal_link_sweep") // v2
    })

    it("treats missing/null flag row as enabled (default-on)", async () => {
      setupRun({ agent_confidence: 9 })
      runSelfCritiqueMock.mockResolvedValueOnce({ overall: "sound", objections: [] })
      shouldReRunAfterCritiqueMock.mockReturnValueOnce(false)
      supabaseFromMock.mockImplementation(defaultSupabaseRouter({ critiqueFlag: null }))

      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-flag-null")

      expect(runSelfCritiqueMock).toHaveBeenCalledTimes(1)
    })

    it("continues with v1 plan if critique throws — does not fail the job", async () => {
      setupRun({ agent_confidence: 5 })
      runSelfCritiqueMock.mockRejectedValueOnce(new Error("Haiku timeout"))

      const insertSpy = vi.fn((_row: Record<string, unknown>) => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "memo-e" }, error: null }) }),
      }))
      supabaseFromMock.mockImplementation((table: string) => {
        if (table === "system_settings") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { value: { enabled: true } }, error: null }) }),
            }),
          }
        }
        if (table === "seo_agent_memos") {
          return {
            insert: insertSpy,
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }
        }
        if (table === "prompt_templates") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { few_shot_examples: [] }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      })

      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-critique-fail")

      // Job succeeds with v1 plan
      const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string }
      expect(finalUpdate?.status).toBe("completed")
      // critique error is recorded in notes
      const memoRow = insertSpy.mock.calls[0]?.[0] as unknown as { self_critique_notes?: string }
      expect(memoRow.self_critique_notes).toContain("failed: Haiku timeout")
      // v1 plan persisted
      expect((insertSpy.mock.calls[0]?.[0] as unknown as { rationale: string }).rationale).toBe("v1 rationale")
    })
  })
})
