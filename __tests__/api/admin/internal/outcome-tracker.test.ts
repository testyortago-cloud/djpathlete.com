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
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          lte: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }))
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

    let fromCallCount = 0
    supabaseFromMock.mockImplementation((table: string) => {
      fromCallCount++
      if (table === "seo_agent_memos") {
        if (fromCallCount === 1) {
          return {
            select: () => ({
              eq: () => ({
                lte: () => Promise.resolve({ data: [memo], error: null }),
              }),
            }),
          }
        }
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }
      }
      return {}
    })

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

    let fromCallCount = 0
    supabaseFromMock.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        return {
          select: () => ({
            eq: () => ({ lte: () => Promise.resolve({ data: memos, error: null }) }),
          }),
        }
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
    })

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

    let fromCallCount = 0
    supabaseFromMock.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        return {
          select: () => ({
            eq: () => ({ lte: () => Promise.resolve({ data: [memo], error: null }) }),
          }),
        }
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
    })

    resolveRefreshOutcome.mockResolvedValueOnce({ executed: true, target_id: "p1", clicks_before: 1, clicks_after: 2 })

    await call()

    expect(resolveNewPostOutcome).not.toHaveBeenCalled()
    expect(resolveRefreshOutcome).toHaveBeenCalledTimes(1)
  })
})
