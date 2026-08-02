import { describe, it, expect } from "vitest"
import { buildProgressions } from "@/lib/profile-share/progression"
import type { RadarTestPoint } from "@/lib/profile-share/data"

function pt(overrides: Partial<RadarTestPoint>): RadarTestPoint {
  return {
    testType: "cmj",
    resultValue: 40,
    resultUnit: "cm",
    customName: null,
    bodyWeightKg: null,
    testDate: "2026-01-01",
    ...overrides,
  }
}

describe("buildProgressions", () => {
  it("computes direction-aware improvement: a FASTER sprint is positive improvement", () => {
    // 2.0s → 1.8s: raw change is -10% but lower-is-better ⇒ +10 improvement.
    // A sign mistake (or ignoring direction) yields -10 and fails here.
    const out = buildProgressions([
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 1.8, resultUnit: "s", testDate: "2026-03-01" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].improvementPct).toBe(10)
    expect(out[0].latest).toBe(1.8)
    expect(out[0].label).toBe("10m Sprint")
  })

  it("computes higher-is-better improvement and orders points chronologically regardless of input order", () => {
    const out = buildProgressions([
      pt({ resultValue: 48, testDate: "2026-06-01" }),
      pt({ resultValue: 40, testDate: "2026-01-01" }),
      pt({ resultValue: 44, testDate: "2026-03-01" }),
    ])
    expect(out[0].points).toEqual([40, 44, 48])
    expect(out[0].improvementPct).toBe(20) // (48-40)/40
    expect(out[0].latestDate).toBe("2026-06-01")
  })

  it("gives custom tests a neutral (null) improvement — no direction is known", () => {
    const out = buildProgressions([
      pt({ testType: "custom", customName: "Serve Speed", resultValue: 90, resultUnit: "mph", testDate: "2026-01-01" }),
      pt({ testType: "custom", customName: "Serve Speed", resultValue: 99, resultUnit: "mph", testDate: "2026-02-01" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].improvementPct).toBeNull()
    expect(out[0].label).toBe("Serve Speed")
  })

  it("keeps custom tests with different names as separate series", () => {
    const out = buildProgressions([
      pt({ testType: "custom", customName: "A", resultValue: 1, testDate: "2026-01-01" }),
      pt({ testType: "custom", customName: "A", resultValue: 2, testDate: "2026-02-01" }),
      pt({ testType: "custom", customName: "B", resultValue: 1, testDate: "2026-01-01" }),
    ])
    expect(out).toHaveLength(1) // B has a single point — excluded
    expect(out[0].label).toBe("A")
  })

  it("excludes single-result tests and returns empty when nothing qualifies", () => {
    expect(buildProgressions([pt({})])).toEqual([])
    expect(buildProgressions([])).toEqual([])
  })

  it("sorts most-improved first with neutral series last, and caps at 6", () => {
    const series: RadarTestPoint[] = [
      // +20%
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 48, testDate: "2026-02-01" }),
      // +50%
      pt({ testType: "pull_up_max", resultValue: 8, resultUnit: "reps", testDate: "2026-01-01" }),
      pt({ testType: "pull_up_max", resultValue: 12, resultUnit: "reps", testDate: "2026-02-01" }),
      // neutral custom
      pt({ testType: "custom", customName: "X", resultValue: 5, testDate: "2026-01-01" }),
      pt({ testType: "custom", customName: "X", resultValue: 6, testDate: "2026-02-01" }),
    ]
    const out = buildProgressions(series)
    expect(out.map((p) => p.label)).toEqual(["Pull-up Max", "Countermovement Jump", "X"])

    const many: RadarTestPoint[] = []
    const types = ["cmj", "sprint_10m", "broad_jump", "pull_up_max", "push_up_max", "plank_hold", "sit_reach"] as const
    for (const t of types) {
      many.push(pt({ testType: t, resultValue: 10, resultUnit: "u", testDate: "2026-01-01" }))
      many.push(pt({ testType: t, resultValue: 12, resultUnit: "u", testDate: "2026-02-01" }))
    }
    expect(buildProgressions(many)).toHaveLength(6)
  })

  it("returns null improvement when the first value is 0 (division guard)", () => {
    const out = buildProgressions([
      pt({ testType: "sit_reach", resultValue: 0, testDate: "2026-01-01" }),
      pt({ testType: "sit_reach", resultValue: 5, testDate: "2026-02-01" }),
    ])
    expect(out[0].improvementPct).toBeNull()
  })
})
