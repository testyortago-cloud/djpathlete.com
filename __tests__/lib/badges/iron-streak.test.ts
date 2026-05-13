import { describe, it, expect } from "vitest"
import { ironStreak } from "@/lib/badges/iron-streak"

describe("ironStreak", () => {
  it("fires bronze at 30+ consecutive training days", () => {
    const daily = Array.from({ length: 35 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return { date: d.toISOString().slice(0, 10), load: 100 }
    })
    const r = ironStreak({
      asOf: "2026-05-14",
      dailyLoads: daily,
      tests: [],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).not.toBeNull()
    expect(r?.tier).toBe("bronze")
  })

  it("returns null at 29 days", () => {
    const daily = Array.from({ length: 29 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return { date: d.toISOString().slice(0, 10), load: 100 }
    })
    const r = ironStreak({
      asOf: "2026-05-14",
      dailyLoads: daily,
      tests: [],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).toBeNull()
  })
})
