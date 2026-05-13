import { describe, it, expect } from "vitest"
import { prMachine } from "@/lib/badges/pr-machine"
import type { PerformanceTest } from "@/types/database"

function pr(date: string): PerformanceTest {
  return {
    id: "x",
    client_user_id: "u",
    created_by: "u",
    test_type: "drop_jump",
    custom_name: null,
    result_value: 0,
    result_unit: "cm",
    trial_values: null,
    best_method: "highest",
    test_date: date,
    body_weight_kg: null,
    notes: null,
    video_url: null,
    is_pr: true,
    pct_change_from_prev: null,
    created_at: "",
    updated_at: "",
  }
}

describe("prMachine", () => {
  it("fires when 3+ PRs in the last 30 days", () => {
    const r = prMachine({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [pr("2026-05-01"), pr("2026-05-05"), pr("2026-05-10")],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).not.toBeNull()
  })

  it("returns null with only 2 PRs", () => {
    const r = prMachine({
      asOf: "2026-05-14",
      dailyLoads: [],
      tests: [pr("2026-05-01"), pr("2026-05-05")],
      readiness: [],
      monthlyCompliancePct: null,
    })
    expect(r).toBeNull()
  })
})
