import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { runSocialOutcomeTracker } from "../social-outcome-tracker.js"
import { getSupabase } from "../lib/supabase.js"

describe("runSocialOutcomeTracker", () => {
  it("marks each aged pending memo as measured", async () => {
    const updates: string[] = []
    const updateChain = {
      eq: vi.fn().mockImplementation((_col: string, id: string) => {
        updates.push(id)
        return Promise.resolve({ data: null, error: null })
      }),
    }
    const update = vi.fn().mockReturnValue(updateChain)
    const aged = [
      { id: "m1", social_post_id: "p1" },
      { id: "m2", social_post_id: "p2" },
    ]
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockResolvedValue({ data: aged, error: null }),
            update,
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
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runSocialOutcomeTracker()
    expect(result.measured).toBe(2)
    expect(updates).toEqual(["m1", "m2"])
  })
})
