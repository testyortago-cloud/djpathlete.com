import { describe, it, expect, vi } from "vitest"
import { resolveExerciseNames } from "../resolve-exercise.js"

const LIB = [
  { id: "ex-squat", name: "Barbell Back Squat" },
  { id: "ex-bench", name: "Barbell Bench Press" },
]

function deps(overrides = {}) {
  return {
    listLibrary: vi.fn(async () => LIB),
    matchByEmbedding: vi.fn(async () => [] as { id: string; similarity: number }[]),
    insertExercise: vi.fn(async (name: string) => ({ id: `new-${name}`, name })),
    embed: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("resolveExerciseNames", () => {
  it("matches exact/normalized names", async () => {
    const map = await resolveExerciseNames(["barbell back squat"], deps())
    expect(map.get("barbell back squat")!.exercise_id).toBe("ex-squat")
    expect(map.get("barbell back squat")!.method).toBe("exact")
  })

  it("uses semantic match above threshold", async () => {
    const d = deps({ matchByEmbedding: vi.fn(async () => [{ id: "ex-bench", similarity: 0.8 }]) })
    const map = await resolveExerciseNames(["flat barbell press"], d)
    expect(map.get("flat barbell press")!.exercise_id).toBe("ex-bench")
    expect(map.get("flat barbell press")!.method).toBe("semantic")
  })

  it("creates a new exercise when nothing matches, once per unique name", async () => {
    const d = deps()
    const map = await resolveExerciseNames(["Sled Push", "sled push"], d)
    expect(d.insertExercise).toHaveBeenCalledTimes(1)
    expect(map.get("sled push")!.created).toBe(true)
    expect(map.get("sled push")!.method).toBe("created")
  })
})
