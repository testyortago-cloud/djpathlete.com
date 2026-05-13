import { describe, it, expect } from "vitest"
import { weeklyStats } from "@/lib/coach-intel/monotony"

describe("weeklyStats", () => {
  it("computes totalLoad, mean, stdDev, monotony, strain over a 7-day window", () => {
    const daily = [
      { date: "2026-05-04", load: 100 },
      { date: "2026-05-05", load: 200 },
      { date: "2026-05-06", load: 150 },
      { date: "2026-05-07", load: 250 },
      { date: "2026-05-08", load: 100 },
      { date: "2026-05-09", load: 0 },
      { date: "2026-05-10", load: 0 },
    ]
    const s = weeklyStats(daily, "2026-05-04")
    expect(s.totalLoad).toBe(800)
    expect(s.mean).toBeCloseTo(800 / 7)
    expect(s.stdDev).toBeGreaterThan(0)
    expect(s.monotony).not.toBeNull()
    expect(s.strain).not.toBeNull()
  })

  it("returns null monotony/strain when stdDev is 0 (uniform load)", () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-${String(4 + i).padStart(2, "0")}`,
      load: 100,
    }))
    const s = weeklyStats(daily, "2026-05-04")
    expect(s.stdDev).toBe(0)
    expect(s.monotony).toBeNull()
    expect(s.strain).toBeNull()
  })

  it("returns null monotony/strain when week is entirely empty", () => {
    const s = weeklyStats([], "2026-05-04")
    expect(s.totalLoad).toBe(0)
    expect(s.mean).toBe(0)
    expect(s.monotony).toBeNull()
    expect(s.strain).toBeNull()
  })
})
