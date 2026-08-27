import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.hoisted(() => vi.fn())
vi.mock("../supabase.js", () => ({ getSupabase: () => ({ from: fromMock }) }))

import { getBlockedExerciseIdsFromFn } from "../exercise-blocks.js"

/**
 * Minimal PostgREST builder stub. Every filter returns the builder so calls
 * chain, and the builder is thenable so `await query` resolves the result —
 * which is how the real client behaves and what the implementation relies on.
 */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, ReturnType<typeof vi.fn> | unknown> = {}
  for (const m of ["select", "eq", "is", "or"]) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

describe("getBlockedExerciseIdsFromFn", () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it("returns the blocked ids as a Set", async () => {
    fromMock.mockReturnValue(builder({ data: [{ exercise_id: "a" }, { exercise_id: "b" }], error: null }))
    const ids = await getBlockedExerciseIdsFromFn("coach-1", "client-1")
    expect(ids).toEqual(new Set(["a", "b"]))
  })

  // These two assert the QUERY SHAPE, which is the whole leak protection: the
  // filter is what stops another client's blocks reaching this generation.
  // Asserting on returned rows would pass against a mock no matter what filter
  // was actually sent.
  it("unions studio-wide with this client when a client id is given", async () => {
    const b = builder({ data: [], error: null })
    fromMock.mockReturnValue(b)
    await getBlockedExerciseIdsFromFn("coach-1", "client-1")
    expect(b.or).toHaveBeenCalledWith("client_id.is.null,client_id.eq.client-1")
    expect(b.is).not.toHaveBeenCalled()
  })

  it("reads studio-wide only when there is no client", async () => {
    const b = builder({ data: [], error: null })
    fromMock.mockReturnValue(b)
    await getBlockedExerciseIdsFromFn("coach-1", null)
    expect(b.is).toHaveBeenCalledWith("client_id", null)
    expect(b.or).not.toHaveBeenCalled()
  })

  it("degrades to an empty Set on error rather than throwing", async () => {
    fromMock.mockReturnValue(builder({ data: null, error: { message: "boom" } }))
    const ids = await getBlockedExerciseIdsFromFn("coach-1", "client-1")
    expect(ids).toEqual(new Set())
  })
})
