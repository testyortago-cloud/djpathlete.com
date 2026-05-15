import { describe, it, expect, vi, beforeEach } from "vitest"

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
    const memoInsert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "m1" }, error: null }) }),
    })
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
        if (table === "chief_strategist_memos") {
          return { insert: memoInsert }
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
        chief_memo: {
          themes_considered: [],
          channels_considered: [],
          confidence: 7,
          dissents_from_critic: false,
          dissent_reason: null,
        },
      },
    })
    const result = await runChiefStrategist()
    expect(result.outcome).toBe("draft_created")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "draft", signal_id: "s1" }),
    )
  })
})

describe("runChiefStrategist — chief_strategist_memos persistence", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("inserts a chief_strategist_memos row after successful brief insert", async () => {
    const fakeBrief = {
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.6 }],
      audience_focus: "rotational athletes",
      priority_channel: "seo" as const,
      keywords_to_chase: ["rotational power"],
      hooks_to_test: ["how rotational athletes recover"],
      ctas: ["book a session"],
      dont_do: ["knee surgery recovery"],
      rationale: "compounding from last week",
    }
    const fakeMemo = {
      themes_considered: [
        { tag: "rotational-power", weight: 0.6, accepted: true, reason: "won last week" },
      ],
      channels_considered: [{ channel: "seo" as const, score: 8, accepted: true }],
      confidence: 8,
      dissents_from_critic: false,
      dissent_reason: null,
    }

    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: { ...fakeBrief, chief_memo: fakeMemo },
        tokens_used: 1234,
      }),
      MODEL_SONNET: "sonnet",
    }))

    const briefInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "brief-1" }, error: null }) }),
    })
    const memoInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "memo-1" }, error: null }) }),
    })

    vi.doMock("../lib/supabase.js", () => ({
      getSupabase: () => ({
        from: (table: string) => {
          if (table === "cross_channel_signals") {
            return {
              select: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: "sig-1",
                          created_at: new Date().toISOString(),
                          preflight_status: "ok",
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === "strategy_briefs") {
            return {
              select: () => ({
                order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
              }),
              insert: briefInsertFn,
            }
          }
          if (table === "chief_strategist_memos") {
            return { insert: memoInsertFn }
          }
          throw new Error(`unexpected table: ${table}`)
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("draft_created")
    expect(memoInsertFn).toHaveBeenCalledTimes(1)
    const memoArg = memoInsertFn.mock.calls[0][0] as { brief_id: string; confidence: number }
    expect(memoArg.brief_id).toBe("brief-1")
    expect(memoArg.confidence).toBe(8)
  })

  it("inserts a chief_strategist_memos row with brief_id=null when brief insert fails", async () => {
    const fakeBrief = {
      week_of: "2026-05-18",
      themes: [{ tag: "x", weight: 1 }],
      audience_focus: "x",
      priority_channel: "seo" as const,
      keywords_to_chase: [],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
      rationale: "x",
    }
    const fakeMemo = {
      themes_considered: [],
      channels_considered: [],
      confidence: 5,
      dissents_from_critic: false,
      dissent_reason: null,
    }

    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: { ...fakeBrief, chief_memo: fakeMemo },
        tokens_used: 1234,
      }),
      MODEL_SONNET: "sonnet",
    }))

    const briefInsertFn = vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({ data: null, error: { message: "brief insert failed" } }),
      }),
    })
    const memoInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "memo-1" }, error: null }) }),
    })

    vi.doMock("../lib/supabase.js", () => ({
      getSupabase: () => ({
        from: (table: string) => {
          if (table === "cross_channel_signals") {
            return {
              select: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: "sig-1",
                          created_at: new Date().toISOString(),
                          preflight_status: "ok",
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === "strategy_briefs") {
            return {
              select: () => ({
                order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
              }),
              insert: briefInsertFn,
            }
          }
          if (table === "chief_strategist_memos") {
            return { insert: memoInsertFn }
          }
          throw new Error(`unexpected table: ${table}`)
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("error")
    expect(memoInsertFn).toHaveBeenCalledTimes(1)
    const memoArg = memoInsertFn.mock.calls[0][0] as { brief_id: string | null }
    expect(memoArg.brief_id).toBeNull()
  })
})
