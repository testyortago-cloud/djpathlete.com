import { describe, it, expect, vi } from "vitest"
import {
  latestApprovedBrief,
  approveBrief,
  patchDraftBrief,
} from "@/lib/db/strategy-briefs"

function mockSupabase(rows: unknown, error: unknown = null) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: rows, error }),
    single: vi.fn().mockResolvedValue({ data: rows, error }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  }
}

describe("strategy_briefs DAL", () => {
  it("latestApprovedBrief filters on approved status", async () => {
    const sb = mockSupabase({ id: "b1", approval_status: "approved" })
    const row = await latestApprovedBrief(sb as never)
    expect(row?.id).toBe("b1")
    expect(sb.eq).toHaveBeenCalledWith("approval_status", "approved")
  })

  it("latestApprovedBrief returns null when no approved row", async () => {
    const sb = mockSupabase(null)
    expect(await latestApprovedBrief(sb as never)).toBeNull()
  })

  it("approveBrief sets status + audit columns", async () => {
    const sb = mockSupabase({ id: "b1" })
    await approveBrief(sb as never, "b1", "user-1")
    expect(sb.update).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved", approved_by: "user-1" }),
    )
  })

  it("patchDraftBrief refuses non-draft rows", async () => {
    const sb = mockSupabase({ id: "b1", approval_status: "approved" })
    await expect(
      patchDraftBrief(sb as never, "b1", { rationale: "new" }),
    ).rejects.toThrow(/draft/i)
  })
})
