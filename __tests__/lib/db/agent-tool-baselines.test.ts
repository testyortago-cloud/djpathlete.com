import { describe, it, expect, vi } from "vitest"
import {
  getBaseline,
  upsertBaseline,
  listChannelBaselines,
  recomputeBaseline,
} from "@/lib/db/agent-tool-baselines"

function mockSupabase(handlers: Record<string, unknown>) {
  return handlers as unknown as Parameters<typeof getBaseline>[0]
}

describe("agent-tool-baselines DAL", () => {
  it("getBaseline returns null when not found", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = mockSupabase({ from })

    const result = await getBaseline(supabase, "seo", "queue_refresh")
    expect(from).toHaveBeenCalledWith("agent_tool_baselines")
    expect(result).toBeNull()
  })

  it("listChannelBaselines orders by n_measured desc", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = mockSupabase({ from })

    await listChannelBaselines(supabase, "ads")
    expect(order).toHaveBeenCalledWith("n_measured", { ascending: false })
  })

  it("upsertBaseline calls upsert on (channel,tool_name) conflict key", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    const supabase = mockSupabase({ from })

    await upsertBaseline(supabase, "seo", "queue_refresh", {
      p95_abs_delta: 60,
      n_measured: 8,
      success_rate: 0.75,
    })
    expect(from).toHaveBeenCalledWith("agent_tool_baselines")
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "seo",
        tool_name: "queue_refresh",
        n_measured: 8,
      }),
      { onConflict: "channel,tool_name" },
    )
  })

  it("recomputeBaseline computes P95 and success_rate from measurements", () => {
    const result = recomputeBaseline([
      { abs_delta: 10, success: true },
      { abs_delta: 20, success: true },
      { abs_delta: 30, success: false },
      { abs_delta: 40, success: true },
      { abs_delta: 100, success: false },
    ])
    // 5 measurements; P95 index = floor(5 * 0.95) = 4 → sortedDeltas[4] = 100
    expect(result.p95_abs_delta).toBe(100)
    expect(result.n_measured).toBe(5)
    expect(result.success_rate).toBeCloseTo(0.6, 5)
  })

  it("recomputeBaseline returns zeros for empty input", () => {
    const result = recomputeBaseline([])
    expect(result).toEqual({ p95_abs_delta: 0, n_measured: 0, success_rate: 0 })
  })
})
