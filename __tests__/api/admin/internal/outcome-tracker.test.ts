import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const isCronSkipped = vi.fn()
const supabaseFromMock = vi.fn()
const firestoreCollectionMock = vi.fn()
const resolveNewPostOutcome = vi.fn()
const resolveRefreshOutcome = vi.fn()
const resolveLinkSweepOutcome = vi.fn()
const resolveFlagOutcome = vi.fn()

vi.mock("@/lib/db/system-settings", () => ({ isCronSkipped }))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: supabaseFromMock }),
}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => ({ collection: firestoreCollectionMock }),
}))
vi.mock("@/lib/seo-agent/outcomes", () => ({
  resolveNewPostOutcome,
  resolveRefreshOutcome,
  resolveLinkSweepOutcome,
  resolveFlagOutcome,
}))

beforeEach(() => {
  isCronSkipped.mockReset()
  supabaseFromMock.mockReset()
  firestoreCollectionMock.mockClear()
  resolveNewPostOutcome.mockReset()
  resolveRefreshOutcome.mockReset()
  resolveLinkSweepOutcome.mockReset()
  resolveFlagOutcome.mockReset()
  process.env.INTERNAL_CRON_TOKEN = "shared-secret"
})

async function call({ bearer = "shared-secret" }: { bearer?: string } = {}) {
  const { POST } = await import("@/app/api/admin/internal/outcome-tracker/route")
  const req = new NextRequest("https://example.test/api/admin/internal/outcome-tracker", {
    method: "POST",
    headers: { authorization: bearer ? `Bearer ${bearer}` : "" },
    body: "{}",
  })
  return POST(req)
}

/**
 * Build a table-aware supabase.from() mock.
 *
 * Routes calls per-table:
 *  - seo_agent_memos: first call is the "pending memos" select; subsequent select calls
 *    are treated as the refreshSeoBaselines window query; non-select calls are updates.
 *  - agent_tool_baselines: select+eq+eq+maybeSingle returns a baseline (or null);
 *    upsert resolves with no error.
 */
function buildSupabase({
  pendingMemos,
  measuredWindow = [],
  baseline = null,
  updateError = null,
  upsertCalls,
  baselineSelectCalls,
}: {
  pendingMemos: unknown[]
  measuredWindow?: unknown[]
  baseline?: { p95_abs_delta: number; n_measured: number; success_rate: number } | null
  updateError?: { message: string } | null
  upsertCalls?: Array<{ channel: string; tool_name: string }>
  baselineSelectCalls?: Array<{ channel: string; tool_name: string }>
}) {
  let memoSelectCount = 0
  return (table: string) => {
    if (table === "seo_agent_memos") {
      return {
        select: () => {
          memoSelectCount++
          if (memoSelectCount === 1) {
            return {
              eq: () => ({
                lte: () => Promise.resolve({ data: pendingMemos, error: null }),
              }),
            }
          }
          // refreshSeoBaselines: select(...).eq().gte()
          return {
            eq: () => ({
              gte: () => Promise.resolve({ data: measuredWindow, error: null }),
            }),
          }
        },
        update: () => ({
          eq: () => Promise.resolve({ error: updateError }),
        }),
      }
    }
    if (table === "agent_tool_baselines") {
      return {
        select: () => ({
          eq: (_col1: string, val1: string) => ({
            eq: (_col2: string, val2: string) => ({
              maybeSingle: () => {
                baselineSelectCalls?.push({ channel: val1, tool_name: val2 })
                return Promise.resolve({ data: baseline, error: null })
              },
            }),
          }),
        }),
        upsert: (row: { channel: string; tool_name: string }) => {
          upsertCalls?.push({ channel: row.channel, tool_name: row.tool_name })
          return Promise.resolve({ error: null })
        },
      }
    }
    return {}
  }
}

describe("POST /api/admin/internal/outcome-tracker", () => {
  it("returns 401 without bearer", async () => {
    const res = await call({ bearer: "" })
    expect(res.status).toBe(401)
  })

  it("returns 401 with wrong bearer", async () => {
    const res = await call({ bearer: "wrong" })
    expect(res.status).toBe(401)
  })

  it("returns { skipped } when cron is disabled", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: true, reason: "disabled" })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: "disabled" })
  })

  it("returns { processed: 0 } when no pending memos older than 14 days", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    supabaseFromMock.mockImplementation(buildSupabase({ pendingMemos: [] }))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 0, measured: [] })
  })

  it("happy path: 1 memo with 2 different-tool actions, both executed, marks measured", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-1",
      run_date: "2026-04-29",
      actions: [
        {
          rank: 1,
          tool: "queue_new_post",
          args: { keyword: "k", angle: "a" },
          executed: true,
          execution_target_id: "cc-1",
        },
        {
          rank: 2,
          tool: "queue_refresh",
          args: { blog_post_id: "p1", reason: "decay" },
          executed: true,
          execution_target_id: "ai-1",
        },
      ],
    }

    const baselineSelectCalls: Array<{ channel: string; tool_name: string }> = []
    const upsertCalls: Array<{ channel: string; tool_name: string }> = []

    // Window source for refreshSeoBaselines: includes outcome_metrics so
    // aggregation produces non-empty byTool grouping.
    const measuredWindowMemo = {
      actions: memo.actions,
      run_date: memo.run_date,
      outcome_metrics: [
        {
          action_index: 0,
          executed: true,
          target_id: "post-1",
          clicks_before: 0,
          clicks_after: 12,
        },
        {
          action_index: 1,
          executed: true,
          target_id: "p1",
          clicks_before: 3,
          clicks_after: 9,
        },
      ],
    }

    supabaseFromMock.mockImplementation(
      buildSupabase({
        pendingMemos: [memo],
        measuredWindow: [measuredWindowMemo],
        baselineSelectCalls,
        upsertCalls,
      }),
    )

    resolveNewPostOutcome.mockResolvedValueOnce({
      executed: true,
      target_id: "post-1",
      clicks_before: 0,
      clicks_after: 12,
      position_before: null,
      position_after: 11.5,
    })
    resolveRefreshOutcome.mockResolvedValueOnce({
      executed: true,
      target_id: "p1",
      clicks_before: 3,
      clicks_after: 9,
      position_before: 18,
      position_after: 12,
    })

    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(1)
    expect(body.measured).toEqual(["memo-1"])

    expect(resolveNewPostOutcome).toHaveBeenCalledTimes(1)
    expect(resolveRefreshOutcome).toHaveBeenCalledTimes(1)
    expect(resolveLinkSweepOutcome).not.toHaveBeenCalled()
    expect(resolveFlagOutcome).not.toHaveBeenCalled()

    // Scoring: two getBaseline lookups (one per executed action with non-zero delta).
    expect(baselineSelectCalls).toEqual(
      expect.arrayContaining([
        { channel: "seo", tool_name: "queue_new_post" },
        { channel: "seo", tool_name: "queue_refresh" },
      ]),
    )
    // Baselines refreshed after batch (memo had two distinct tools).
    expect(upsertCalls.map((c) => c.tool_name).sort()).toEqual([
      "queue_new_post",
      "queue_refresh",
    ])
  })

  it("dispatches each tool to the correct resolver across multiple memos", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memos = [
      {
        id: "m-sweep",
        run_date: "2026-04-29",
        actions: [
          { rank: 1, tool: "queue_internal_link_sweep", args: {}, executed: true, execution_target_id: "ai-2" },
          { rank: 2, tool: "flag_for_human", args: {}, executed: true, execution_target_id: "notif-1" },
        ],
      },
    ]

    supabaseFromMock.mockImplementation(buildSupabase({ pendingMemos: memos, measuredWindow: memos }))

    resolveLinkSweepOutcome.mockResolvedValueOnce({ executed: true, target_id: "p", clicks_before: 1, clicks_after: 4 })
    resolveFlagOutcome.mockResolvedValueOnce({ executed: true, target_id: "notif-1", acknowledged: true })

    const res = await call()
    expect(res.status).toBe(200)
    expect(resolveLinkSweepOutcome).toHaveBeenCalledTimes(1)
    expect(resolveLinkSweepOutcome).toHaveBeenCalledWith(
      "ai-2",
      "2026-04-29",
      expect.anything(),
      expect.anything(),
    )
    expect(resolveFlagOutcome).toHaveBeenCalledTimes(1)
    expect(resolveFlagOutcome).toHaveBeenCalledWith("notif-1", expect.anything())
  })

  it("skips resolution for actions with executed=false, records as { executed: false }", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-2",
      run_date: "2026-04-29",
      actions: [
        { rank: 1, tool: "queue_new_post", args: {}, executed: false, execution_target_id: null },
        { rank: 2, tool: "queue_refresh", args: {}, executed: true, execution_target_id: "ai-1" },
      ],
    }

    supabaseFromMock.mockImplementation(buildSupabase({ pendingMemos: [memo], measuredWindow: [memo] }))

    resolveRefreshOutcome.mockResolvedValueOnce({ executed: true, target_id: "p1", clicks_before: 1, clicks_after: 2 })

    await call()

    expect(resolveNewPostOutcome).not.toHaveBeenCalled()
    expect(resolveRefreshOutcome).toHaveBeenCalledTimes(1)
  })

  it("writes impact_score on the memo update and respects the warm-up gate (n<5)", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-warmup",
      run_date: "2026-04-29",
      actions: [
        {
          rank: 1,
          tool: "queue_new_post",
          args: { keyword: "k", angle: "a" },
          executed: true,
          execution_target_id: "cc-1",
        },
      ],
    }

    let capturedUpdate: Record<string, unknown> | null = null
    let memoSelectCount = 0
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "seo_agent_memos") {
        return {
          select: () => {
            memoSelectCount++
            if (memoSelectCount === 1) {
              return {
                eq: () => ({
                  lte: () => Promise.resolve({ data: [memo], error: null }),
                }),
              }
            }
            return {
              eq: () => ({
                gte: () => Promise.resolve({ data: [], error: null }),
              }),
            }
          },
          update: (payload: Record<string, unknown>) => {
            capturedUpdate = payload
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === "agent_tool_baselines") {
        return {
          // Warm-up: no baseline row yet (n_measured = 0 < WARM_UP_THRESHOLD=5)
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        }
      }
      return {}
    })

    resolveNewPostOutcome.mockResolvedValueOnce({
      executed: true,
      target_id: "post-1",
      clicks_before: 0,
      clicks_after: 12, // positive delta with predicted_direction=increase -> +50 in warm-up
      position_before: null,
      position_after: 11.5,
    })

    const res = await call()
    expect(res.status).toBe(200)
    expect(capturedUpdate).toEqual(
      expect.objectContaining({
        outcome_status: "measured",
        impact_score: 50,
      }),
    )
  })

  it("returns impact_score: null when memo has no executed actions", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-noop",
      run_date: "2026-04-29",
      actions: [
        { rank: 1, tool: "queue_new_post", args: {}, executed: false, execution_target_id: null },
      ],
    }

    let capturedUpdate: Record<string, unknown> | null = null
    let memoSelectCount = 0
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "seo_agent_memos") {
        return {
          select: () => {
            memoSelectCount++
            if (memoSelectCount === 1) {
              return {
                eq: () => ({
                  lte: () => Promise.resolve({ data: [memo], error: null }),
                }),
              }
            }
            return {
              eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }),
            }
          },
          update: (payload: Record<string, unknown>) => {
            capturedUpdate = payload
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === "agent_tool_baselines") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        }
      }
      return {}
    })

    const res = await call()
    expect(res.status).toBe(200)
    expect(capturedUpdate).toEqual(expect.objectContaining({ impact_score: null }))
  })

  it("does not refresh baselines when zero memos are measured", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })

    const memo = {
      id: "memo-update-fails",
      run_date: "2026-04-29",
      actions: [
        {
          rank: 1,
          tool: "queue_new_post",
          args: {},
          executed: true,
          execution_target_id: "cc-1",
        },
      ],
    }

    let baselineSelectCount = 0
    let measuredWindowFetched = false
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "seo_agent_memos") {
        let selectCount = 0
        return {
          select: () => {
            selectCount++
            if (selectCount === 1) {
              return {
                eq: () => ({
                  lte: () => Promise.resolve({ data: [memo], error: null }),
                }),
              }
            }
            measuredWindowFetched = true
            return {
              eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }),
            }
          },
          // Force update to fail so the memo never lands in `measured`.
          update: () => ({
            eq: () => Promise.resolve({ error: { message: "boom" } }),
          }),
        }
      }
      if (table === "agent_tool_baselines") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => {
                  baselineSelectCount++
                  return Promise.resolve({ data: null, error: null })
                },
              }),
            }),
          }),
          upsert: () => Promise.resolve({ error: null }),
        }
      }
      return {}
    })

    resolveNewPostOutcome.mockResolvedValueOnce({
      executed: true,
      target_id: "post-1",
      clicks_before: 0,
      clicks_after: 5,
    })

    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.measured).toEqual([])
    // Scoring still ran (baselineSelectCount > 0), but baselines were NOT refreshed.
    expect(baselineSelectCount).toBeGreaterThan(0)
    expect(measuredWindowFetched).toBe(false)
  })
})
