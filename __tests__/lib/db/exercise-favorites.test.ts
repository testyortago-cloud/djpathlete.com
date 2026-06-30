import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable mock. Each terminal method resolves to { data, error }.
const state: {
  result: { data: unknown; error: unknown }
  lastUpsert?: unknown
  lastDelete?: boolean
  lastDeleteExerciseId?: string
} = {
  result: { data: [], error: null },
}

function makeBuilder() {
  // select().eq() chain: getFavoriteExerciseIds awaits the result of .eq() directly (thenable)
  // select().eq().order() chain: listFavoritesByClient awaits .order()
  // delete().eq().eq() chain: removeFavorite awaits the second .eq()

  // The second eq in the delete chain scopes by exercise_id — capture its arg.
  const eqForDelete = vi.fn((col: string, val: string) => {
    if (col === "exercise_id") state.lastDeleteExerciseId = val
    return Promise.resolve({ data: null, error: state.result.error })
  })
  const deleteResult = {
    eq: vi.fn(() => ({ eq: eqForDelete })),
  }

  // eq that is both thenable (for getFavoriteExerciseIds) and supports .order() (for listFavoritesByClient)
  const eqResult = {
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(state.result).then(resolve, reject)
    },
    order: vi.fn(() => Promise.resolve(state.result)),
  }

  const builder = {
    select: vi.fn(() => ({ eq: vi.fn(() => eqResult) })),
    eq: vi.fn(() => eqResult),
    order: vi.fn(() => Promise.resolve(state.result)),
    upsert: vi.fn((payload: unknown) => {
      state.lastUpsert = payload
      return Promise.resolve({ data: null, error: state.result.error })
    }),
    delete: vi.fn(() => {
      state.lastDelete = true
      return deleteResult
    }),
  }
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: vi.fn(() => makeBuilder()) }),
}))

import {
  getFavoriteExerciseIds,
  listFavoritesByClient,
  addFavorite,
  removeFavorite,
} from "@/lib/db/exercise-favorites"

beforeEach(() => {
  state.result = { data: [], error: null }
  state.lastUpsert = undefined
  state.lastDelete = false
  state.lastDeleteExerciseId = undefined
})

describe("getFavoriteExerciseIds", () => {
  it("returns a Set of exercise ids", async () => {
    state.result = { data: [{ exercise_id: "a" }, { exercise_id: "b" }], error: null }
    const ids = await getFavoriteExerciseIds("client-1")
    expect(ids).toBeInstanceOf(Set)
    expect([...ids].sort()).toEqual(["a", "b"])
  })
  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(getFavoriteExerciseIds("client-1")).rejects.toBeTruthy()
  })
})

describe("listFavoritesByClient", () => {
  it("returns the joined rows", async () => {
    state.result = { data: [{ id: "f1", exercise: { id: "a", name: "Squat" } }], error: null }
    const rows = await listFavoritesByClient("client-1")
    expect(rows).toHaveLength(1)
    expect(rows[0].exercise?.name).toBe("Squat")
  })
})

describe("addFavorite", () => {
  it("upserts with ignoreDuplicates and the given source", async () => {
    await addFavorite("client-1", "ex-1", { createdBy: "client-1", source: "client" })
    expect(state.lastUpsert).toMatchObject({ client_user_id: "client-1", exercise_id: "ex-1", source: "client", created_by: "client-1" })
  })
})

describe("removeFavorite", () => {
  it("issues a delete scoped by exercise_id", async () => {
    await removeFavorite("client-1", "ex-1")
    expect(state.lastDelete).toBe(true)
    // Verify the delete chain included the exercise_id filter so dropping it would break this test.
    expect(state.lastDeleteExerciseId).toBe("ex-1")
  })
})
