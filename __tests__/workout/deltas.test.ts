import { describe, it, expect } from "vitest"
import { computeExerciseDelta } from "@/lib/workout/deltas"

describe("computeExerciseDelta", () => {
  it("up when current top set beats last", () => {
    expect(computeExerciseDelta(50, [{ weight_kg: 40 }])).toEqual({ pct: 25, direction: "up" })
  })
  it("down when lower", () => {
    const d = computeExerciseDelta(36, [{ weight_kg: 40 }])
    expect(d.direction).toBe("down")
    expect(d.pct).toBe(10)
  })
  it("uses the first non-null historical weight", () => {
    expect(computeExerciseDelta(44, [{ weight_kg: null }, { weight_kg: 40 }]).direction).toBe("up")
  })
  it("neutral with no history", () => {
    expect(computeExerciseDelta(40, [])).toEqual({ pct: null, direction: "neutral" })
  })
  it("neutral when current is null/zero", () => {
    expect(computeExerciseDelta(null, [{ weight_kg: 40 }]).direction).toBe("neutral")
  })
})
