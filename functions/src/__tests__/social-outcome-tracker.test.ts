import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { runSocialOutcomeTracker } from "../social-outcome-tracker.js"
import { getSupabase } from "../lib/supabase.js"

describe("runSocialOutcomeTracker", () => {
  it("marks each aged pending memo as measured and writes impact_score", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
    const update = vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
      eq: vi.fn().mockImplementation((_col: string, id: string) => {
        updates.push({ id, patch })
        return Promise.resolve({ data: null, error: null })
      }),
    }))
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const aged = [
      { id: "m1", social_post_id: "p1" },
      { id: "m2", social_post_id: "p2" },
    ]
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            // select() for pending fetch + measured-window fetch in refresh
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === "outcome_status" && val === "pending") {
                  return {
                    lt: vi.fn().mockResolvedValue({ data: aged, error: null }),
                  }
                }
                // measured + 90-day window for refreshSocialBaseline
                return {
                  gte: vi.fn().mockResolvedValue({
                    data: [
                      { outcome_metrics: { engagement_delta: 12.5 } },
                      { outcome_metrics: { engagement_delta: -3 } },
                    ],
                    error: null,
                  }),
                }
              }),
            })),
            update,
            upsert,
          }
        }
        if (table === "social_analytics") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [{ likes: 12, comments: 1, shares: 0, impressions: 200, engagement_rate: 0.06 }],
              error: null,
            }),
          }
        }
        if (table === "agent_tool_baselines") {
          return {
            // baseline lookup during scoring
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            // upsert during refresh
            upsert,
          }
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)

    const result = await runSocialOutcomeTracker()

    expect(result.measured).toBe(2)
    expect(updates.map((u) => u.id)).toEqual(["m1", "m2"])
    // Every memo update should carry an impact_score and engagement_delta in metrics.
    for (const u of updates) {
      expect(u.patch.outcome_status).toBe("measured")
      expect(u.patch.impact_score).toBeTypeOf("number")
      const m = u.patch.outcome_metrics as { engagement_delta: number }
      expect(m.engagement_delta).toBeGreaterThan(0)
    }
    // With no baseline (n_measured < 5 warm-up), a positive delta scores +50.
    expect(updates[0].patch.impact_score).toBe(50)
    // Baseline refresh should fire once after the batch.
    expect(upsert).toHaveBeenCalled()
  })

  it("returns 0 measurements when no aged memos exist", async () => {
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                lt: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
            update: vi.fn(),
            upsert: vi.fn(),
          }
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runSocialOutcomeTracker()
    expect(result.measured).toBe(0)
  })
})
