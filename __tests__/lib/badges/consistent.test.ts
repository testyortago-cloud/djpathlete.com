import { describe, it, expect } from "vitest"
import { consistent } from "@/lib/badges/consistent"

describe("consistent", () => {
  it("fires silver at 90% monthly compliance", () => {
    const r = consistent({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: [],
      monthlyCompliancePct: 92,
    })
    expect(r?.tier).toBe("silver")
  })

  it("fires gold at 100% monthly compliance", () => {
    const r = consistent({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: [],
      monthlyCompliancePct: 100,
    })
    expect(r?.tier).toBe("gold")
  })

  it("returns null below 90%", () => {
    const r = consistent({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: [],
      monthlyCompliancePct: 80,
    })
    expect(r).toBeNull()
  })
})
