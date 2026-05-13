import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  updateAgentMemoLifecycle,
  listMemosPendingOutcomes,
} from "@/lib/db/google-ads-agent-memos"

// Spies that track each Supabase query-builder call. Reset in beforeEach so
// each test sees a clean call history. The mock below wires these into a
// chainable builder so we can assert the DAL invokes the right chain with
// the right arguments — not merely that it doesn't throw.
const from = vi.fn()
const update = vi.fn()
const eq = vi.fn()
const select = vi.fn()
const lt = vi.fn()
const order = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (...args: unknown[]) => {
      from(...args)
      return {
        update: (payload: unknown) => {
          update(payload)
          return {
            eq: (col: string, val: unknown) => {
              eq(col, val)
              return Promise.resolve({ error: null })
            },
          }
        },
        select: (...args: unknown[]) => {
          select(...args)
          return {
            eq: (col: string, val: unknown) => {
              eq(col, val)
              return {
                lt: (col2: string, val2: unknown) => {
                  lt(col2, val2)
                  return {
                    order: (col3: string, opts: unknown) => {
                      order(col3, opts)
                      return Promise.resolve({ data: [], error: null })
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }),
}))

describe("google-ads-agent-memos DAL", () => {
  beforeEach(() => {
    from.mockReset()
    update.mockReset()
    eq.mockReset()
    select.mockReset()
    lt.mockReset()
    order.mockReset()
  })

  describe("updateAgentMemoLifecycle", () => {
    it("writes all 5 lifecycle columns and filters by id", async () => {
      await updateAgentMemoLifecycle("memo-id", {
        signals_summary: { foo: "bar" },
        actions: [],
        guardrail_rejections: [],
        outcome_status: "pending",
      })
      expect(from).toHaveBeenCalledWith("google_ads_agent_memos")
      expect(update).toHaveBeenCalledTimes(1)
      const payload = update.mock.calls[0][0] as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        "actions",
        "guardrail_rejections",
        "outcome_metrics",
        "outcome_status",
        "signals_summary",
      ])
      expect(payload.signals_summary).toEqual({ foo: "bar" })
      expect(eq).toHaveBeenCalledWith("id", "memo-id")
    })

    it("defaults outcome_metrics to null when caller omits it", async () => {
      await updateAgentMemoLifecycle("memo-id", {
        signals_summary: null,
        actions: [],
        guardrail_rejections: [],
        outcome_status: "preflight_failed",
      })
      const payload = update.mock.calls[0][0] as Record<string, unknown>
      expect(payload.outcome_metrics).toBeNull()
      expect(payload.outcome_status).toBe("preflight_failed")
    })
  })

  describe("listMemosPendingOutcomes", () => {
    it("filters for pending status, applies created_at cutoff, orders ascending", async () => {
      const result = await listMemosPendingOutcomes(7)
      expect(from).toHaveBeenCalledWith("google_ads_agent_memos")
      expect(select).toHaveBeenCalledWith("*")
      expect(eq).toHaveBeenCalledWith("outcome_status", "pending")
      expect(lt).toHaveBeenCalledTimes(1)
      const [col, cutoff] = lt.mock.calls[0]
      expect(col).toBe("created_at")
      expect(typeof cutoff).toBe("string")
      // ISO 8601 sanity check
      expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(order).toHaveBeenCalledWith("created_at", { ascending: true })
      expect(result).toEqual([])
    })

    it("defaults olderThanDays to 14", async () => {
      await listMemosPendingOutcomes()
      const [, cutoff] = lt.mock.calls[0]
      const cutoffMs = new Date(cutoff as string).getTime()
      const expectedMs = Date.now() - 14 * 86_400_000
      // Allow 5s of slack for test execution
      expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5_000)
    })
  })
})
