import { describe, it, expect, vi, beforeEach } from "vitest"

const supabaseMock = { from: vi.fn() }
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => supabaseMock,
}))

import { createIfNew, acknowledge } from "@/lib/db/risk-flags"

beforeEach(() => vi.clearAllMocks())

describe("risk-flags DAL", () => {
  it("createIfNew returns null when an open flag of same type exists within 7 days", async () => {
    supabaseMock.from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({ data: [{ id: "existing" }], error: null }),
            }),
          }),
        }),
      }),
    })
    const r = await createIfNew("u1", {
      flag_type: "fatigue",
      severity: "medium",
      message: "x",
      evidence: {},
      triggered_at: "2026-05-13",
    })
    expect(r).toBeNull()
  })

  it("createIfNew inserts when no recent open flag of same type exists", async () => {
    supabaseMock.from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    })
    const insertFn = vi.fn().mockReturnValue({
      select: () => ({ single: () => ({ data: { id: "f1" }, error: null }) }),
    })
    supabaseMock.from.mockReturnValueOnce({ insert: insertFn })
    const r = await createIfNew("u1", {
      flag_type: "fatigue",
      severity: "medium",
      message: "x",
      evidence: {},
      triggered_at: "2026-05-13",
    })
    expect(r).toEqual({ id: "f1" })
    expect(insertFn).toHaveBeenCalled()
  })

  it("acknowledge sets status='acknowledged' + acknowledged_at + acknowledged_by", async () => {
    const updateFn = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({ single: () => ({ data: { id: "f1" }, error: null }) }),
      }),
    })
    supabaseMock.from.mockReturnValue({ update: updateFn })
    await acknowledge("f1", "admin-1")
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "acknowledged",
        acknowledged_by: "admin-1",
      }),
    )
  })
})
