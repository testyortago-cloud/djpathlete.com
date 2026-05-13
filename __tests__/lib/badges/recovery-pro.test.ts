import { describe, it, expect } from "vitest"
import { recoveryPro } from "@/lib/badges/recovery-pro"
import type { DailyReadiness } from "@/types/database"

function readiness(date: string, score: number): DailyReadiness {
  return {
    id: "x",
    client_user_id: "u",
    date,
    sleep_hours: null,
    sleep_quality: 5,
    soreness_overall: 1,
    soreness_by_region: {},
    fatigue: 1,
    mood: 5,
    stress: 1,
    hydration: 5,
    resting_hr: null,
    hrv_ms: null,
    notes: null,
    readiness_score: score,
    created_at: "",
    updated_at: "",
  }
}

describe("recoveryPro", () => {
  it("fires when 14 consecutive days have readiness ≥ 80", () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return readiness(d.toISOString().slice(0, 10), 85)
    })
    const r = recoveryPro({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: days,
      monthlyCompliancePct: null,
    })
    expect(r).not.toBeNull()
  })

  it("returns null when one day dips below 80", () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date("2026-05-14T00:00:00Z")
      d.setUTCDate(d.getUTCDate() - i)
      return readiness(d.toISOString().slice(0, 10), i === 5 ? 70 : 85)
    })
    const r = recoveryPro({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [],
      readiness: days,
      monthlyCompliancePct: null,
    })
    expect(r).toBeNull()
  })
})
