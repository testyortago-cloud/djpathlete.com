import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { upsert, getLatest } from "@/lib/db/training-sessions"

beforeEach(() => vi.clearAllMocks())

describe("training-sessions DAL", () => {
  it("upsert calls supabase.upsert with onConflict on (client_user_id, date, session_type)", async () => {
    const upsertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => ({ data: { id: "t1" }, error: null }) }),
    })
    supabaseMock.from.mockReturnValue({ upsert: upsertFn })
    await upsert("u1", {
      date: "2026-05-13",
      session_type: "gym",
      rpe: 7,
      duration_min: 60,
      notes: null,
      program_assignment_id: null,
    } as never)
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        client_user_id: "u1",
        date: "2026-05-13",
        session_type: "gym",
        rpe: 7,
      }),
      { onConflict: "client_user_id,date,session_type" },
    )
  })

  it("getLatest orders by date desc and limits N", async () => {
    const rows = [{ id: "t1" }]
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ data: rows, error: null }) }) }),
      }),
    })
    const r = await getLatest("u1", 10)
    expect(r).toEqual(rows)
  })
})
