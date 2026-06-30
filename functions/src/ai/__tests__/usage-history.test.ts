import { describe, it, expect, vi, beforeEach } from "vitest"

const selectEq = vi.fn()
vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({ select: () => ({ eq: selectEq }) }),
  }),
}))

import { getClientFavoriteExerciseIds } from "../usage-history.js"

beforeEach(() => selectEq.mockReset())

describe("getClientFavoriteExerciseIds", () => {
  it("returns an empty Set for a null client", async () => {
    const ids = await getClientFavoriteExerciseIds(null)
    expect(ids.size).toBe(0)
  })
  it("maps rows to a Set of exercise ids", async () => {
    selectEq.mockResolvedValue({ data: [{ exercise_id: "a" }, { exercise_id: "b" }], error: null })
    const ids = await getClientFavoriteExerciseIds("c1")
    expect([...ids].sort()).toEqual(["a", "b"])
  })
  it("returns an empty Set on error (best-effort)", async () => {
    selectEq.mockResolvedValue({ data: null, error: { message: "x" } })
    const ids = await getClientFavoriteExerciseIds("c1")
    expect(ids.size).toBe(0)
  })
})
