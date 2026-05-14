import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-6",
}))

import { runChiefStrategist } from "../chief-strategist.js"
import { getSupabase } from "../lib/supabase.js"
import { callAgent } from "../ai/anthropic.js"

describe("runChiefStrategist", () => {
  it("skips when no signal exists", async () => {
    const sb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runChiefStrategist()
    expect(result.outcome).toBe("no_signal")
    expect(callAgent).not.toHaveBeenCalled()
  })

  it("inserts a draft brief when a fresh signal exists", async () => {
    const insert = vi.fn().mockReturnThis()
    const select = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null })
    const recentSignal = {
      id: "s1",
      created_at: new Date().toISOString(),
      preflight_status: "ok",
      recommendations_for_brief: [],
    }
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "cross_channel_signals") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: recentSignal, error: null }),
          }
        }
        if (table === "strategy_briefs") {
          return {
            insert,
            select,
            single,
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    ;(callAgent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: {
        week_of: "2026-05-18",
        themes: [{ tag: "rotational-power", weight: 0.8 }],
        audience_focus: "x",
        priority_channel: "seo",
        keywords_to_chase: [],
        hooks_to_test: [],
        ctas: [],
        dont_do: [],
        rationale: "ok",
      },
    })
    const result = await runChiefStrategist()
    expect(result.outcome).toBe("draft_created")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "draft", signal_id: "s1" }),
    )
  })
})
