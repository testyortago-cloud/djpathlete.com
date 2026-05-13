import { describe, it, expect } from "vitest"
import { normalize, RADAR_CATEGORIES } from "@/lib/coach-intel/test-normalization"

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
    expect(Object.keys(RADAR_CATEGORIES)).toEqual([
      "Speed",
      "Power",
      "Strength",
      "Endurance",
      "Mobility",
    ])
  })
})
