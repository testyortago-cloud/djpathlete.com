import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-6",
}))

import { runPerformanceCritic } from "../performance-critic.js"
import { getSupabase } from "../lib/supabase.js"
import { callAgent } from "../ai/anthropic.js"

/**
 * Build a Supabase mock where read-table chains return the supplied `data`.
 * The returned `chain` is both chainable (`.select().gte().order()`) and thenable
 * (so awaiting it resolves to `{ data, error: null }`), matching B1's pattern.
 */
function makeReadChain(data: unknown[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    not: vi.fn(() => chain),
    range: vi.fn(() => chain),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data, error: null }),
  }
  return chain
}

describe("runPerformanceCritic", () => {
  it("writes preflight_failed signal when fewer than 2 channels have memos", async () => {
    const insert = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "s1" }, error: null })
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "cross_channel_signals") {
          // Insert path: insert().select().single()
          return {
            insert,
            select: vi.fn().mockReturnThis(),
            single,
            // Also thenable for the read path in gatherCriticInputs
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
              resolve({ data: [], error: null }),
          }
        }
        // All memo / attribution / voice tables return empty -> preflight fails
        return makeReadChain([])
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runPerformanceCritic()
    expect(result.outcome).toBe("preflight_failed")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ preflight_status: "failed" }),
    )
    expect(callAgent).not.toHaveBeenCalled()
  })

  it("writes ok signal row when preflight passes", async () => {
    const insert = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "s2" }, error: null })
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "cross_channel_signals") {
          return {
            insert,
            select: vi.fn().mockReturnThis(),
            single,
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
              resolve({ data: [], error: null }),
          }
        }
        if (table === "seo_agent_memos" || table === "social_agent_memos") {
          return makeReadChain([{ id: `m-${table}` }])
        }
        return makeReadChain([])
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    ;(callAgent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: {
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: ["focus rotational"],
        rationale: "ok",
      },
    })

    const result = await runPerformanceCritic()
    expect(result.outcome).toBe("ok")
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ preflight_status: "ok" }))
  })

  // G41. A failed read used to become an empty list, so the critic wrote a
  // signal saying nothing happened, and the Chief Strategist read it as fact.
  // The failed row matters: with NO row, the Chief Strategist (Sunday) takes
  // last Saturday's signal, 7.9 days old and inside its 8-day window, and
  // writes a brief from stale data. A preflight_status "failed" row is what it
  // already treats as stale_signal.
  it("answers outcome 'error' and writes a FAILED signal carrying the reason when an input cannot be read", async () => {
    vi.mocked(callAgent).mockClear()
    const insert = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { id: "s-err" }, error: null })
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "marketing_attribution") {
          const chain: Record<string, unknown> = {
            select: vi.fn(() => chain),
            gte: vi.fn(() => chain),
            order: vi.fn(() => chain),
            range: vi.fn(() => chain),
            then: (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
              resolve({ data: null, error: { message: 'column "first_seen_at" does not exist' } }),
          }
          return chain
        }
        if (table === "cross_channel_signals") {
          return {
            insert,
            select: vi.fn().mockReturnThis(),
            single,
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return makeReadChain([{ id: `m-${table}` }])
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)

    const result = await runPerformanceCritic()

    expect(result.outcome).toBe("error")
    expect(result.reasons?.join(" ")).toMatch(/marketing_attribution/)
    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0][0] as { preflight_status: string; preflight_reasons: string[] }
    expect(row.preflight_status).toBe("failed")
    expect(row.preflight_reasons.join(" ")).toMatch(/marketing_attribution/)
    expect(callAgent).not.toHaveBeenCalled()
  })
})
