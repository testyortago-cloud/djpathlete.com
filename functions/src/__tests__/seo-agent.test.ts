import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

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
      data: () => ({
        status: "pending",
        type: "seo_agent_run",
        input: { userId: "admin-uuid", businessId: "biz-1" },
      }),
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
    // G35: the job's business reaches every executor, beside the memo and
    // the user. MUTANT: ctx built as { memoId, userId } — flag_for_human then
    // has no business to find owners in.
    expect(executeActionMock.mock.calls.map((c) => c[1])).toEqual([
      { memoId: "memo-1", userId: "admin-uuid", businessId: "biz-1" },
      { memoId: "memo-1", userId: "admin-uuid", businessId: "biz-1" },
    ])
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

  describe("the job's business, and what each action did (G35)", () => {
    const spies: Array<{ mockRestore: () => void }> = []
    afterEach(() => {
      for (const s of spies.splice(0)) s.mockRestore()
    })
    function silence(method: "log" | "warn" | "error") {
      const spy = vi.spyOn(console, method).mockImplementation(() => {})
      spies.push(spy)
      return spy
    }
    const messages = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]))

    function runWith(input: Record<string, unknown>, results: Array<Record<string, unknown>>) {
      jobRefGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: "pending", type: "seo_agent_run", input }),
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
          rationale: "r",
          actions: [
            { rank: 1, tool: "flag_for_human", args: { issue: "i", urgency: "low", context: "c" } },
            { rank: 2, tool: "queue_new_post", args: { keyword: "deadlift", angle: "a" } },
          ],
          brief_alignment_score: null,
          agent_confidence: 9,
          dissent_from_upstream: { dissents: false, reason: null },
        },
        tokens_used: 1,
      })
      for (const r of results) executeActionMock.mockResolvedValueOnce(r)
      supabaseFromMock.mockImplementation(defaultSupabaseRouter({ critiqueFlag: { enabled: false } }))
    }

    // MUTANT: default a missing businessId to the platform business. A job
    // enqueued by a route older than G35 carries none; flag_for_human then
    // fails closed, and this warning is where that shows in the logs.
    it("threads a job with no businessId as null, and warns that its alert will not be sent", async () => {
      const warn = silence("warn")
      silence("log")
      runWith({ userId: "u" }, [
        { executed: true, execution_target_id: "t1" },
        { executed: true, execution_target_id: "t2" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-old-route")
      expect(executeActionMock.mock.calls[0]?.[1]).toEqual({ memoId: "memo-1", userId: "u", businessId: null })
      expect(messages(warn).some((m) => m.includes("no input.businessId"))).toBe(true)
    })

    // Presence control for the warning above: same run, business present.
    it("does not warn when the job carries its business", async () => {
      const warn = silence("warn")
      silence("log")
      runWith({ userId: "u", businessId: "biz-1" }, [
        { executed: true, execution_target_id: "t1" },
        { executed: true, execution_target_id: "t2" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-new-route")
      expect(executeActionMock.mock.calls[0]?.[1]).toEqual({ memoId: "memo-1", userId: "u", businessId: "biz-1" })
      expect(messages(warn).some((m) => m.includes("no input.businessId"))).toBe(false)
    })

    // MUTANT: the old log line, which printed executed and target only. The
    // flag's PGRST205 went unseen on every run for exactly that reason.
    it("logs an action's error and a guardrail's rejection instead of dropping them", async () => {
      const error = silence("error")
      const warn = silence("warn")
      runWith({ userId: "u", businessId: "biz-1" }, [
        { executed: false, execution_target_id: null, error: "business biz-1 has no owner to notify" },
        { executed: false, execution_target_id: null, rejection_reason: "brief_dont_do:deadlift" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-failed-actions")
      expect(messages(error)).toContainEqual(
        expect.stringContaining(
          "tool=flag_for_human executed=false target=null error=business biz-1 has no owner to notify",
        ),
      )
      expect(messages(warn)).toContainEqual(
        expect.stringContaining("tool=queue_new_post executed=false target=null rejected=brief_dont_do:deadlift"),
      )
    })

    // Presence control: a clean action still logs on console.log, unadorned.
    it("logs a clean action as before", async () => {
      const log = silence("log")
      const error = silence("error")
      runWith({ userId: "u", businessId: "biz-1" }, [
        { executed: true, execution_target_id: "notif-1" },
        { executed: true, execution_target_id: "cc-1" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-clean")
      expect(messages(log)).toContainEqual(
        "[seo-agent] action rank=1 tool=flag_for_human executed=true target=notif-1",
      )
      expect(messages(error)).toEqual([])
    })
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
