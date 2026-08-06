import { describe, it, expect } from "vitest"
import { normalize, referenceTargets, RADAR_CATEGORIES } from "@/lib/coach-intel/test-normalization"

describe("normalize", () => {
  it("drop_jump 60cm = 100 (max of higher-is-better)", () => {
    expect(normalize("drop_jump", 60)).toBe(100)
  })
  it("drop_jump 20cm = 0 (min)", () => {
    expect(normalize("drop_jump", 20)).toBe(0)
  })
  it("sprint_10m 1.5s = 100 (min of lower-is-better)", () => {
    expect(normalize("sprint_10m", 1.5)).toBe(100)
  })
  it("sprint_10m 2.5s = 0 (max of lower-is-better)", () => {
    expect(normalize("sprint_10m", 2.5)).toBe(0)
  })
  it("clamps values outside the range", () => {
    expect(normalize("drop_jump", 100)).toBe(100)
    expect(normalize("drop_jump", 0)).toBe(0)
  })
  it("bench_press_1rm relative-to-body-weight midrange", () => {
    const r = normalize("bench_press_1rm", 80, 80)
    expect(r).not.toBeNull()
    expect(r! >= 25 && r! <= 50).toBe(true)
  })
  it("returns null when relativeToBodyWeight test has no bodyweight", () => {
    expect(normalize("bench_press_1rm", 80)).toBeNull()
  })
  it("RADAR_CATEGORIES covers all 5 axes", () => {
    expect(Object.keys(RADAR_CATEGORIES)).toEqual(["Speed", "Power", "Strength", "Endurance", "Mobility"])
  })
})

describe("referenceTargets", () => {
  it("puts elite at the GOOD end of the range for a higher-is-better test", () => {
    // cmj range 25-65 cm, higher is better.
    expect(referenceTargets("cmj")).toMatchObject({ elite: 65, trained: 45, direction: "higher" })
  })

  it("puts elite at the FASTER end for a lower-is-better test", () => {
    // sprint_10m range 1.5-2.5 s, lower is better — elite must be 1.5, not 2.5.
    expect(referenceTargets("sprint_10m")).toMatchObject({ elite: 1.5, trained: 2, direction: "lower" })
  })

  it("converts bodyweight-relative targets into absolute units", () => {
    // back_squat_1rm range 0.5-2.5 x bodyweight; at 100 kg that is 250 / 150 kg.
    expect(referenceTargets("back_squat_1rm", 100)).toMatchObject({
      elite: 250,
      trained: 150,
      relativeToBodyWeight: true,
    })
  })

  it("returns null for a bodyweight-relative test with no usable body weight", () => {
    expect(referenceTargets("back_squat_1rm")).toBeNull()
    expect(referenceTargets("back_squat_1rm", 0)).toBeNull()
    expect(referenceTargets("back_squat_1rm", -5)).toBeNull()
  })

  it("returns null for a test with no reference range", () => {
    expect(referenceTargets("custom")).toBeNull()
  })
})
