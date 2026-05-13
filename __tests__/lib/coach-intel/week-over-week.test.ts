import { describe, it, expect } from "vitest"
import { weekOverWeek } from "@/lib/coach-intel/week-over-week"

describe("weekOverWeek", () => {
  it("reports +50% when current week is 1.5x prior week", () => {
    const daily = [
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-04-${String(27 + i).padStart(2, "0")}`,
        load: 100,
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-05-${String(4 + i).padStart(2, "0")}`,
        load: 150,
      })),
    ]
    const r = weekOverWeek(daily, "2026-05-04")
    expect(r.current.totalLoad).toBe(1050)
    expect(r.previous.totalLoad).toBe(700)
    expect(r.deltaPct).toBeCloseTo(50, 1)
  })

  it("returns null deltaPct when previous week had zero load", () => {
    const daily = [
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-05-${String(4 + i).padStart(2, "0")}`,
        load: 100,
      })),
    ]
    const r = weekOverWeek(daily, "2026-05-04")
    expect(r.deltaPct).toBeNull()
  })
})
