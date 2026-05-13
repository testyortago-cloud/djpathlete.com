import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => supabaseMock }))

import { markAchieved } from "@/lib/db/athlete-goals"

beforeEach(() => vi.clearAllMocks())

describe("athlete-goals DAL", () => {
  it("markAchieved sets status='achieved' + achieved_at", async () => {
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({ single: () => ({ data: { id: "g1" }, error: null }) }),
      }),
    })
    supabaseMock.from.mockReturnValue({ update: updateFn })
    await markAchieved("g1", "2026-05-14")
    expect(updateFn).toHaveBeenCalledWith({
      status: "achieved",
      achieved_at: "2026-05-14",
    })
  })
})
