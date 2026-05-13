import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { getActive, resolve, addMilestone } from "@/lib/db/injuries"

beforeEach(() => vi.clearAllMocks())

describe("injuries DAL", () => {
  it("getActive filters by status in (active, recovering)", async () => {
    const rows = [{ id: "i1", status: "active" }]
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ in: () => ({ order: () => ({ data: rows, error: null }) }) }),
      }),
    })
    const r = await getActive("u1")
    expect(r).toEqual(rows)
  })

  it("resolve sets status='resolved' and date_resolved", async () => {
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: () => ({ data: { id: "i1", status: "resolved" }, error: null }),
        }),
      }),
    })
    supabaseMock.from.mockReturnValue({ update: updateFn })
    await resolve("i1", "2026-05-13")
    expect(updateFn).toHaveBeenCalledWith({
      status: "resolved",
      date_resolved: "2026-05-13",
    })
  })

  it("addMilestone appends to rehab_milestones array", async () => {
    const existing = {
      id: "i1",
      rehab_milestones: [{ name: "ROM", target_date: null, completed_date: null, notes: null }],
    }
    supabaseMock.from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({ single: () => ({ data: existing, error: null }) }),
      }),
    })
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: () => ({
            data: {
              ...existing,
              rehab_milestones: [...existing.rehab_milestones, { name: "Run" }],
            },
            error: null,
          }),
        }),
      }),
    })
    supabaseMock.from.mockReturnValueOnce({ update: updateFn })
    await addMilestone("i1", {
      name: "Run",
      target_date: null,
      completed_date: null,
      notes: null,
    })
    expect(updateFn).toHaveBeenCalledWith({
      rehab_milestones: [
        ...existing.rehab_milestones,
        { name: "Run", target_date: null, completed_date: null, notes: null },
      ],
    })
  })
})
