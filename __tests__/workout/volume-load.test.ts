import { describe, it, expect } from "vitest"
import { computeVolumeLoad, computeSessionVolumeLoad } from "@/lib/workout/volume-load"

const sets = [
  { weight_kg: 40, reps: 10 },
  { weight_kg: 40, reps: 8 },
]

describe("computeVolumeLoad", () => {
  it("total: sum(reps*weight)", () => {
    expect(computeVolumeLoad(sets, "total")).toBe(40 * 10 + 40 * 8) // 720
  })
  it("per_dumbbell: ×2", () => {
    expect(computeVolumeLoad(sets, "per_dumbbell")).toBe(720 * 2) // 1440
  })
  it("ignores null/empty weight or reps", () => {
    expect(
      computeVolumeLoad([{ weight_kg: null, reps: 10 }, { weight_kg: 30, reps: null }], "total"),
    ).toBe(0)
  })
  it("empty → 0", () => {
    expect(computeVolumeLoad([], "total")).toBe(0)
    expect(computeVolumeLoad(null, "total")).toBe(0)
  })
})

describe("computeSessionVolumeLoad", () => {
  it("sums across exercises", () => {
    expect(
      computeSessionVolumeLoad([
        { sets, loadType: "total" }, // 720
        { sets: [{ weight_kg: 20, reps: 10 }], loadType: "per_dumbbell" }, // 400
      ]),
    ).toBe(720 + 400)
  })
})
