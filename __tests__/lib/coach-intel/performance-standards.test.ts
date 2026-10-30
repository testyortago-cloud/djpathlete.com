import { describe, it, expect } from "vitest"
import {
  TRAINED_SCORE,
  defaultStandard,
  normalize,
  pickStandard,
  referenceTargets,
  standardOrderProblem,
  type StandardRow,
} from "@/lib/coach-intel/test-normalization"
import { bandFor, BAND_STRENGTH_MIN } from "@/lib/test-report/scoring"

/**
 * The coach's own Trained / Elite standards (2026-10-30): editable per test and per
 * age group, and a result AT Trained reads green ("Strength").
 */
const row = (p: Partial<StandardRow> & { trained_value: number; elite_value: number }): StandardRow => ({
  test_type: "cmj",
  age_min: null,
  age_max: null,
  floor_value: 20,
  ...p,
})

describe("normalize against a standard", () => {
  const cmj = { floor: 20, trained: 40, elite: 60, direction: "higher" as const, relativeToBodyWeight: false }
  it("scores the starting point 0, Trained TRAINED_SCORE and Elite 100", () => {
    expect(normalize("cmj", 20, null, cmj)).toBe(0)
    expect(normalize("cmj", 40, null, cmj)).toBe(TRAINED_SCORE)
    expect(normalize("cmj", 60, null, cmj)).toBe(100)
  })
  it("a result at Trained is green, just below it is not", () => {
    expect(BAND_STRENGTH_MIN).toBe(TRAINED_SCORE)
    expect(bandFor(normalize("cmj", 40, null, cmj)!)).toBe("strength")
    expect(bandFor(normalize("cmj", 39, null, cmj)!)).toBe("developing")
  })
  it("is linear on each side of Trained, and clamps past either end", () => {
    expect(normalize("cmj", 30, null, cmj)).toBe(33) // halfway to Trained: 65/2
    expect(normalize("cmj", 50, null, cmj)).toBe(83) // halfway Trained to Elite: 65 + 35/2
    expect(normalize("cmj", 5, null, cmj)).toBe(0)
    expect(normalize("cmj", 90, null, cmj)).toBe(100)
  })
  it("a sprint, where lower is better, scores the faster time higher", () => {
    const sprint = { floor: 2.4, trained: 2.0, elite: 1.6, direction: "lower" as const, relativeToBodyWeight: false }
    expect(normalize("sprint_10m", 2.0, null, sprint)).toBe(TRAINED_SCORE)
    expect(normalize("sprint_10m", 1.6, null, sprint)).toBe(100)
    expect(normalize("sprint_10m", 2.5, null, sprint)).toBe(0)
  })
})

describe("pickStandard", () => {
  const rows = [
    row({ trained_value: 40, elite_value: 60 }), // all ages
    row({ age_min: 12, age_max: 18, trained_value: 30, elite_value: 45 }),
    row({ age_min: 14, age_max: 15, trained_value: 33, elite_value: 48 }),
    row({ test_type: "broad_jump", floor_value: 150, trained_value: 220, elite_value: 280 }),
  ]
  it("uses the narrowest age group containing the client's age", () => {
    expect(pickStandard(rows, "cmj", 14)?.trained).toBe(33)
    expect(pickStandard(rows, "cmj", 17)?.trained).toBe(30)
  })
  it("falls back to the all-ages row outside every age group, or with no age known", () => {
    expect(pickStandard(rows, "cmj", 30)?.trained).toBe(40)
    expect(pickStandard(rows, "cmj", null)?.trained).toBe(40)
  })
  it("falls back to the built-in standard for a test the coach has not set", () => {
    expect(pickStandard(rows, "drop_jump", 14)).toEqual(defaultStandard("drop_jump"))
    expect(pickStandard([], "cmj", 14)).toEqual(defaultStandard("cmj"))
  })
  it("keeps the test's own direction and body-weight rule", () => {
    const s = pickStandard(
      [row({ test_type: "back_squat_1rm", floor_value: 0.5, trained_value: 1.2, elite_value: 2 })],
      "back_squat_1rm",
      null,
    )
    expect(s).toMatchObject({ trained: 1.2, direction: "higher", relativeToBodyWeight: true })
    expect(referenceTargets("back_squat_1rm", 80, s)).toMatchObject({ trained: 96, elite: 160 })
  })
  it("a custom test has no standard", () => {
    expect(pickStandard(rows, "custom", 14)).toBeNull()
  })
})

describe("the built-in standard", () => {
  it("is the worse end of the old range, its middle, and its better end", () => {
    expect(defaultStandard("cmj")).toMatchObject({ floor: 25, trained: 45, elite: 65 })
    expect(defaultStandard("sprint_10m")).toMatchObject({ floor: 2.5, trained: 2, elite: 1.5 })
  })
})

describe("standardOrderProblem", () => {
  it("accepts numbers that go up for a higher-is-better test", () => {
    expect(standardOrderProblem("cmj", 20, 40, 60)).toBeNull()
  })
  it("refuses them out of order", () => {
    expect(standardOrderProblem("cmj", 20, 60, 40)).toMatch(/go up/)
    expect(standardOrderProblem("cmj", 40, 40, 60)).toMatch(/go up/)
  })
  it("wants them to go down for a sprint", () => {
    expect(standardOrderProblem("sprint_10m", 2.4, 2.0, 1.6)).toBeNull()
    expect(standardOrderProblem("sprint_10m", 1.6, 2.0, 2.4)).toMatch(/Lower is better/)
  })
})
