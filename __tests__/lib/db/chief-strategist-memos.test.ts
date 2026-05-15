import { describe, it, expect, vi } from "vitest"
import {
  insertChiefMemo,
  latestChiefMemo,
  chiefMemoForBrief,
  markBriefRejected,
} from "@/lib/db/chief-strategist-memos"

function mockSupabase(handlers: Record<string, unknown>) {
  return handlers as unknown as Parameters<typeof insertChiefMemo>[0]
}

describe("chief-strategist-memos DAL", () => {
  it("insertChiefMemo posts to chief_strategist_memos and returns the row", async () => {
    const inserted = {
      id: "memo-1",
      brief_id: "brief-1",
      signal_id: "sig-1",
      themes_considered: [],
      channels_considered: [],
      confidence: 8,
      dissents_from_critic: false,
      dissent_reason: null,
      self_critique_notes: null,
      rationale: "test",
      brief_was_rejected: false,
      rejection_reason: null,
      created_at: "2026-05-15T00:00:00Z",
    }
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    const supabase = mockSupabase({ from })

    const result = await insertChiefMemo(supabase, {
      brief_id: "brief-1",
      signal_id: "sig-1",
      themes_considered: [],
      channels_considered: [],
      confidence: 8,
      dissents_from_critic: false,
      dissent_reason: null,
      self_critique_notes: null,
      rationale: "test",
    })

    expect(from).toHaveBeenCalledWith("chief_strategist_memos")
    expect(result.id).toBe("memo-1")
  })

  it("markBriefRejected updates the row whose brief_id matches", async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const from = vi.fn().mockReturnValue({ update })
    const supabase = mockSupabase({ from })

    await markBriefRejected(supabase, "brief-1", "off-brand themes")

    expect(from).toHaveBeenCalledWith("chief_strategist_memos")
    expect(update).toHaveBeenCalledWith({
      brief_was_rejected: true,
      rejection_reason: "off-brand themes",
    })
  })

  it("latestChiefMemo orders by created_at desc and returns null when empty", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = mockSupabase({ from })

    const result = await latestChiefMemo(supabase)

    expect(order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(result).toBeNull()
  })

  it("chiefMemoForBrief filters by brief_id and returns null if not found", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const supabase = mockSupabase({ from })

    const result = await chiefMemoForBrief(supabase, "brief-xyz")

    expect(eq).toHaveBeenCalledWith("brief_id", "brief-xyz")
    expect(result).toBeNull()
  })
})
