import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = {
  from: vi.fn(),
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { getByUserAndDate, upsert, getReadinessTrend } from "@/lib/db/daily-readiness"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("daily-readiness DAL", () => {
  it("getByUserAndDate returns single row", async () => {
    const expected = { id: "r1", client_user_id: "u1", date: "2026-05-13", readiness_score: 75 }
    const single = vi.fn().mockResolvedValue({ data: expected, error: null })
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ single }) }) }),
    })
    const r = await getByUserAndDate("u1", "2026-05-13")
    expect(r).toEqual(expected)
  })

  it("upsert calls supabase.upsert with onConflict", async () => {
    const upsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => ({ data: { id: "r1" }, error: null }) }),
    })
    supabaseMock.from.mockReturnValue({ upsert: upsertFn })
    await upsert("u1", "2026-05-13", { sleep_quality: 4 } as never)
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ client_user_id: "u1", date: "2026-05-13", sleep_quality: 4 }),
      { onConflict: "client_user_id,date" },
    )
  })

  it("getReadinessTrend returns date + score pairs", async () => {
    const rows = [
      { date: "2026-05-12", readiness_score: 70 },
      { date: "2026-05-13", readiness_score: 80 },
    ]
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ gte: () => ({ order: () => ({ data: rows, error: null }) }) }),
      }),
    })
    const r = await getReadinessTrend("u1", 7)
    expect(r).toEqual(rows)
  })
})
