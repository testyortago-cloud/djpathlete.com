import { describe, it, expect, vi, beforeEach } from "vitest"

const rangeMock = vi.fn()
const inMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          neq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          range: rangeMock,
          in: inMock,
        }
        return chain
      },
    }),
  }),
}))

import { getTotalVolumeKg } from "@/lib/db/workout-sessions"
import { getExerciseNamesByIds } from "@/lib/db/exercises"

describe("getTotalVolumeKg", () => {
  beforeEach(() => rangeMock.mockReset())

  it("sums volume_load_kg and treats nulls as 0", async () => {
    rangeMock.mockResolvedValueOnce({
      data: [{ volume_load_kg: 100.5 }, { volume_load_kg: null }, { volume_load_kg: 200 }],
      error: null,
    })
    expect(await getTotalVolumeKg("u1")).toBeCloseTo(300.5)
    expect(rangeMock).toHaveBeenCalledTimes(1)
  })

  it("paginates past the 1000-row page", async () => {
    const page = Array.from({ length: 1000 }, () => ({ volume_load_kg: 1 }))
    rangeMock
      .mockResolvedValueOnce({ data: page, error: null })
      .mockResolvedValueOnce({ data: [{ volume_load_kg: 5 }], error: null })
    expect(await getTotalVolumeKg("u1")).toBe(1005)
    expect(rangeMock).toHaveBeenCalledTimes(2)
    expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 999)
    expect(rangeMock).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it("returns partial total on error", async () => {
    rangeMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    expect(await getTotalVolumeKg("u1")).toBe(0)
  })
})

describe("getExerciseNamesByIds", () => {
  beforeEach(() => inMock.mockReset())

  it("returns an empty map for no ids without querying", async () => {
    expect(await getExerciseNamesByIds([])).toEqual({})
    expect(inMock).not.toHaveBeenCalled()
  })

  it("maps id → name", async () => {
    inMock.mockResolvedValueOnce({ data: [{ id: "e1", name: "Back Squat" }], error: null })
    expect(await getExerciseNamesByIds(["e1"])).toEqual({ e1: "Back Squat" })
  })
})
