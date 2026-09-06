import { describe, it, expect } from "vitest"
import {
  displayWeight,
  formatWeight,
  formatWeightCompact,
  toKg,
  unitLabel,
} from "@/lib/weight-utils"

/**
 * The bug these pin: `toKg` rounded STORAGE to 2dp, so a coach typing 40 lbs
 * persisted 18.14 kg, which rendered back to the client as 39.99 lbs.
 * 484 production rows carried this drift.
 */
describe("weight-utils — lbs round-trip", () => {
  const whole = Array.from({ length: 500 }, (_, i) => i + 1)
  const halves = Array.from({ length: 400 }, (_, i) => (i + 1) * 2.5)

  it.each([10, 15, 35, 40, 60, 80, 115, 140, 185, 225, 315])(
    "%i lbs survives the store-then-display round trip",
    (lbs) => {
      expect(displayWeight(toKg(lbs, "lbs"), "lbs")).toBe(lbs)
    },
  )

  it("round-trips every whole lb from 1 to 500", () => {
    const drifted = whole.filter((lbs) => displayWeight(toKg(lbs, "lbs"), "lbs") !== lbs)
    expect(drifted).toEqual([])
  })

  it("round-trips every 2.5 lb plate increment to 1000", () => {
    const drifted = halves.filter((lbs) => displayWeight(toKg(lbs, "lbs"), "lbs") !== lbs)
    expect(drifted).toEqual([])
  })

  it("stores more precision than it displays", () => {
    // The specific regression: 2dp storage is not enough. If STORAGE_DECIMALS
    // is lowered back to 2 this fails, because 18.14 renders as 39.99.
    const stored = toKg(40, "lbs")
    expect(stored).toBeGreaterThan(18.1435)
    expect(stored).toBeLessThan(18.1438)
    expect(displayWeight(stored, "lbs")).toBe(40)
  })
})

describe("weight-utils — kg passthrough", () => {
  it("stores a kg entry unchanged", () => {
    expect(toKg(100, "kg")).toBe(100)
    expect(toKg(82.5, "kg")).toBe(82.5)
  })

  it("rounds the kg DISPLAY, so precise storage never leaks decimals on screen", () => {
    // Regression guard: displayWeight used to return the raw kg value. Now that
    // storage carries 6dp, an unrounded kg branch would show 18.143716 kg.
    expect(displayWeight(18.143716, "kg")).toBe(18.14)
    expect(formatWeight(18.143716, "kg")).toBe("18.14 kg")
  })
})

describe("weight-utils — formatting", () => {
  it("returns -- for null in both formatters", () => {
    expect(displayWeight(null, "lbs")).toBeNull()
    expect(formatWeight(null, "lbs")).toBe("--")
    expect(formatWeightCompact(null, "kg")).toBe("--")
  })

  it("labels the value with its unit", () => {
    expect(formatWeight(toKg(40, "lbs"), "lbs")).toBe("40 lbs")
    expect(formatWeightCompact(toKg(40, "lbs"), "lbs")).toBe("40lbs")
    expect(formatWeight(80, "kg")).toBe("80 kg")
    expect(unitLabel("kg")).toBe("kg")
    expect(unitLabel("lbs")).toBe("lbs")
  })
})
