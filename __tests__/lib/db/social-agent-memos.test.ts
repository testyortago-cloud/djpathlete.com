import { describe, it, expect, vi } from "vitest"
import {
  recentSocialAgentMemos,
  insertSocialAgentMemo,
} from "@/lib/db/social-agent-memos"

describe("social_agent_memos DAL", () => {
  it("recentSocialAgentMemos orders by created_at desc", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const sb = { from: vi.fn().mockReturnValue({ select }) }
    const rows = await recentSocialAgentMemos(sb as never, 5)
    expect(rows).toHaveLength(1)
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false })
  })

  it("insertSocialAgentMemo throws on error", async () => {
    const sb = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    }
    await expect(
      insertSocialAgentMemo(sb as never, {
        run_date: "2026-05-15",
        ai_job_id: null,
        brief_id: null,
        brief_alignment_score: null,
        ran_without_brief: true,
        signals_summary: {},
        actions: [],
        rationale: "x",
        outcome_status: "pending",
        outcome_metrics: null,
        social_post_id: null,
        platform: null,
      }),
    ).rejects.toThrow(/boom/)
  })
})
