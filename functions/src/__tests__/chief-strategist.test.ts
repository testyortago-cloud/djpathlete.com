import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-6",
}))
vi.mock("../lib/self-critique.js", () => ({
  runSelfCritique: vi.fn(),
  shouldReRunAfterCritique: vi.fn(),
}))

import { runChiefStrategist } from "../chief-strategist.js"
import { getSupabase } from "../lib/supabase.js"
import { callAgent } from "../ai/anthropic.js"
import { runSelfCritique, shouldReRunAfterCritique } from "../lib/self-critique.js"

describe("runChiefStrategist", () => {
  beforeEach(() => {
    ;(runSelfCritique as unknown as ReturnType<typeof vi.fn>).mockReset()
    ;(shouldReRunAfterCritique as unknown as ReturnType<typeof vi.fn>).mockReset()
    ;(callAgent as unknown as ReturnType<typeof vi.fn>).mockReset()
    // Default: critique returns 'sound' and re-run heuristic returns false.
    ;(runSelfCritique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      overall: "sound",
      objections: [],
    })
    ;(shouldReRunAfterCritique as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
  })

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
        if (table === "agent_tool_baselines") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        if (table === "system_settings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { value: { enabled: true } }, error: null }),
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

    vi.doMock("../lib/self-critique.js", () => ({
      runSelfCritique: vi.fn().mockResolvedValue({ overall: "sound", objections: [] }),
      shouldReRunAfterCritique: vi.fn().mockReturnValue(false),
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
          if (table === "agent_tool_baselines") {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          if (table === "system_settings") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { value: { enabled: true } }, error: null }),
                }),
              }),
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
          throw new Error(`unexpected table: ${table}`)
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("draft_created")
    expect(memoInsertFn).toHaveBeenCalledTimes(1)
    const memoArg = memoInsertFn.mock.calls[0][0] as {
      brief_id: string
      confidence: number
      self_critique_notes: string | null
    }
    expect(memoArg.brief_id).toBe("brief-1")
    expect(memoArg.confidence).toBe(8)
    expect(memoArg.self_critique_notes).toContain("[v1 critique]")
    expect(memoArg.self_critique_notes).toContain("overall=sound")
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

    vi.doMock("../lib/self-critique.js", () => ({
      runSelfCritique: vi.fn().mockResolvedValue({ overall: "sound", objections: [] }),
      shouldReRunAfterCritique: vi.fn().mockReturnValue(false),
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
          if (table === "agent_tool_baselines") {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          if (table === "system_settings") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { value: { enabled: true } }, error: null }),
                }),
              }),
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

describe("runChiefStrategist — self-critique re-run", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("re-runs Chief once when critique flags should_revise AND confidence <= 7; uses v2 finalContent for brief + memo", async () => {
    const v1Brief = {
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.6 }],
      audience_focus: "rotational athletes",
      priority_channel: "seo" as const,
      keywords_to_chase: ["rotational power"],
      hooks_to_test: ["how rotational athletes recover"],
      ctas: ["book a session"],
      dont_do: [],
      rationale: "v1 rationale",
      chief_memo: {
        themes_considered: [
          { tag: "rotational-power", weight: 0.6, accepted: true, reason: "won last week" },
        ],
        channels_considered: [{ channel: "seo" as const, score: 7, accepted: true }],
        confidence: 6,
        dissents_from_critic: false,
        dissent_reason: null,
      },
    }
    const v2Brief = {
      week_of: "2026-05-18",
      themes: [{ tag: "comeback-code", weight: 0.7 }],
      audience_focus: "returning athletes",
      priority_channel: "social" as const,
      keywords_to_chase: ["comeback story"],
      hooks_to_test: ["athlete comeback after injury"],
      ctas: ["dm us"],
      dont_do: ["surgery"],
      rationale: "v2 rationale, revised after critique",
      chief_memo: {
        themes_considered: [
          { tag: "comeback-code", weight: 0.7, accepted: true, reason: "addresses critique" },
        ],
        channels_considered: [{ channel: "social" as const, score: 9, accepted: true }],
        confidence: 8,
        dissents_from_critic: false,
        dissent_reason: null,
      },
    }

    const callAgentMock = vi
      .fn()
      .mockResolvedValueOnce({ content: v1Brief, tokens_used: 1000 })
      .mockResolvedValueOnce({ content: v2Brief, tokens_used: 1100 })

    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: callAgentMock,
      MODEL_SONNET: "sonnet",
    }))

    const runSelfCritiqueMock = vi.fn().mockResolvedValue({
      overall: "should_revise",
      objections: ["seo channel underperforms historically — bias to social"],
    })
    const shouldReRunAfterCritiqueMock = vi.fn().mockReturnValue(true)

    vi.doMock("../lib/self-critique.js", () => ({
      runSelfCritique: runSelfCritiqueMock,
      shouldReRunAfterCritique: shouldReRunAfterCritiqueMock,
    }))

    const briefInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "brief-2" }, error: null }) }),
    })
    const memoInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "memo-2" }, error: null }) }),
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
                          id: "sig-2",
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
          if (table === "agent_tool_baselines") {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          if (table === "system_settings") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { value: { enabled: true } }, error: null }),
                }),
              }),
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
          throw new Error(`unexpected table: ${table}`)
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("draft_created")
    // Two callAgent calls: original + revised
    expect(callAgentMock).toHaveBeenCalledTimes(2)
    expect(runSelfCritiqueMock).toHaveBeenCalledTimes(1)
    expect(shouldReRunAfterCritiqueMock).toHaveBeenCalledTimes(1)
    // shouldReRunAfterCritique was passed v1's confidence (6), not v2's (8)
    expect(shouldReRunAfterCritiqueMock.mock.calls[0][1]).toBe(6)

    // Brief insert must reflect v2 (finalContent)
    expect(briefInsertFn).toHaveBeenCalledTimes(1)
    const briefArg = briefInsertFn.mock.calls[0][0] as {
      priority_channel: string
      rationale: string
      themes: Array<{ tag: string }>
    }
    expect(briefArg.priority_channel).toBe("social")
    expect(briefArg.rationale).toBe("v2 rationale, revised after critique")
    expect(briefArg.themes[0]?.tag).toBe("comeback-code")

    // Memo insert must reflect v2 chief_memo and contain critique notes
    expect(memoInsertFn).toHaveBeenCalledTimes(1)
    const memoArg = memoInsertFn.mock.calls[0][0] as {
      confidence: number
      self_critique_notes: string | null
      rationale: string
    }
    expect(memoArg.confidence).toBe(8)
    expect(memoArg.rationale).toBe("v2 rationale, revised after critique")
    expect(memoArg.self_critique_notes).toContain("[v1 themes]")
    expect(memoArg.self_critique_notes).toContain("[critique]")
    expect(memoArg.self_critique_notes).toContain("[v2 themes]")
    expect(memoArg.self_critique_notes).toContain("rotational-power") // v1
    expect(memoArg.self_critique_notes).toContain("comeback-code") // v2
  })

  it("skips critique entirely when flag is disabled; uses v1 content and notes are null", async () => {
    const v1Brief = {
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.6 }],
      audience_focus: "x",
      priority_channel: "seo" as const,
      keywords_to_chase: [],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
      rationale: "v1",
      chief_memo: {
        themes_considered: [],
        channels_considered: [],
        confidence: 5,
        dissents_from_critic: false,
        dissent_reason: null,
      },
    }
    const callAgentMock = vi.fn().mockResolvedValue({ content: v1Brief, tokens_used: 1000 })

    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: callAgentMock,
      MODEL_SONNET: "sonnet",
    }))

    const runSelfCritiqueMock = vi.fn()
    vi.doMock("../lib/self-critique.js", () => ({
      runSelfCritique: runSelfCritiqueMock,
      shouldReRunAfterCritique: vi.fn().mockReturnValue(false),
    }))

    const briefInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "brief-3" }, error: null }) }),
    })
    const memoInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "memo-3" }, error: null }) }),
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
                          id: "sig-3",
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
          if (table === "agent_tool_baselines") {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          if (table === "system_settings") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { value: { enabled: false } }, error: null }),
                }),
              }),
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
          throw new Error(`unexpected table: ${table}`)
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("draft_created")
    expect(callAgentMock).toHaveBeenCalledTimes(1)
    expect(runSelfCritiqueMock).not.toHaveBeenCalled()

    const memoArg = memoInsertFn.mock.calls[0][0] as { self_critique_notes: string | null }
    expect(memoArg.self_critique_notes).toBeNull()
  })

  it("continues with v1 content if critique throws — does not fail the run", async () => {
    const v1Brief = {
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.6 }],
      audience_focus: "x",
      priority_channel: "seo" as const,
      keywords_to_chase: [],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
      rationale: "v1",
      chief_memo: {
        themes_considered: [],
        channels_considered: [],
        confidence: 5,
        dissents_from_critic: false,
        dissent_reason: null,
      },
    }
    const callAgentMock = vi.fn().mockResolvedValue({ content: v1Brief, tokens_used: 1000 })

    vi.doMock("../ai/anthropic.js", () => ({
      callAgent: callAgentMock,
      MODEL_SONNET: "sonnet",
    }))

    vi.doMock("../lib/self-critique.js", () => ({
      runSelfCritique: vi.fn().mockRejectedValue(new Error("Haiku timeout")),
      shouldReRunAfterCritique: vi.fn().mockReturnValue(false),
    }))

    const briefInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "brief-4" }, error: null }) }),
    })
    const memoInsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: "memo-4" }, error: null }) }),
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
                          id: "sig-4",
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
          if (table === "agent_tool_baselines") {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          if (table === "system_settings") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { value: { enabled: true } }, error: null }),
                }),
              }),
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
          throw new Error(`unexpected table: ${table}`)
        },
      }),
    }))

    const { runChiefStrategist } = await import("../chief-strategist.js")
    const result = await runChiefStrategist()

    expect(result.outcome).toBe("draft_created")
    // only v1 callAgent invoked
    expect(callAgentMock).toHaveBeenCalledTimes(1)

    const memoArg = memoInsertFn.mock.calls[0][0] as { self_critique_notes: string | null }
    expect(memoArg.self_critique_notes).toContain("failed: Haiku timeout")
  })
})
