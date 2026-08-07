import { describe, it, expect } from "vitest"
import {
  bandFor,
  buildReportScores,
  BAND_STRENGTH_MIN,
  BAND_DEVELOPING_MIN,
  type ReportTestPoint,
} from "@/lib/test-report/scoring"

function pt(
  over: Partial<ReportTestPoint> & Pick<ReportTestPoint, "testType" | "resultValue" | "testDate">,
): ReportTestPoint {
  return {
    resultUnit: "cm",
    customName: null,
    bodyWeightKg: null,
    isPr: false,
    ...over,
  } as ReportTestPoint
}

describe("bandFor", () => {
  it("places scores in the right band at every boundary", () => {
    expect(bandFor(BAND_STRENGTH_MIN)).toBe("strength")
    expect(bandFor(BAND_STRENGTH_MIN - 1)).toBe("developing")
    expect(bandFor(BAND_DEVELOPING_MIN)).toBe("developing")
    expect(bandFor(BAND_DEVELOPING_MIN - 1)).toBe("priority")
    expect(bandFor(0)).toBe("priority")
    expect(bandFor(100)).toBe("strength")
  })
})

describe("buildReportScores", () => {
  it("returns empty scores for no tests", () => {
    const s = buildReportScores([])
    expect(s.athleteScore).toBeNull()
    expect(s.categories).toEqual([])
    expect(s.tests).toEqual([])
    expect(s.strongest).toBeNull()
    expect(s.focalPoints).toEqual([])
    expect(s.biggestMover).toBeNull()
  })

  it("scores a jump against its reference range", () => {
    // cmj range is 25-65 cm, higher is better. 45 sits exactly halfway → 50.
    const s = buildReportScores([pt({ testType: "cmj", resultValue: 45, testDate: "2026-06-01" })])
    expect(s.tests[0].score).toBe(50)
    expect(s.categories).toHaveLength(1)
    expect(s.categories[0].category).toBe("Power")
    expect(s.categories[0].score).toBe(50)
    expect(s.athleteScore).toBe(50)
  })

  it("treats a FASTER sprint as an improvement even though the number went down", () => {
    const s = buildReportScores([
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 1.8, resultUnit: "s", testDate: "2026-03-01" }),
    ])
    expect(s.tests[0].deltaPct).toBe(10)
    expect(s.biggestMover!.test.label).toBe("10m Sprint")
    expect(s.biggestMover!.test.deltaPct).toBe(10)
    expect(s.biggestMover!.isDecline).toBe(false)
  })

  it("picks the biggest IMPROVEMENT even when a decline is larger in magnitude", () => {
    const s = buildReportScores([
      // Mobility collapses 20 -> 10 = -50%.
      pt({ testType: "sit_reach", resultValue: 20, testDate: "2026-01-01" }),
      pt({ testType: "sit_reach", resultValue: 10, testDate: "2026-06-01" }),
      // Power improves 40 -> 48 = +20%.
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 48, testDate: "2026-06-01" }),
    ])
    expect(s.biggestMover).not.toBeNull()
    expect(s.biggestMover!.test.label).toBe("Countermovement Jump")
    expect(s.biggestMover!.test.deltaPct).toBe(20)
    expect(s.biggestMover!.isDecline).toBe(false)
  })

  it("falls back to the largest decline when NOTHING improved, and says so", () => {
    const s = buildReportScores([
      pt({ testType: "sit_reach", resultValue: 20, testDate: "2026-01-01" }),
      pt({ testType: "sit_reach", resultValue: 18, testDate: "2026-06-01" }), // -10%
      pt({ testType: "cmj", resultValue: 50, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-06-01" }), // -20%
    ])
    expect(s.biggestMover!.test.label).toBe("Countermovement Jump")
    expect(s.biggestMover!.test.deltaPct).toBe(-20)
    expect(s.biggestMover!.isDecline).toBe(true)
  })

  it("carries the previous value so the report can print 'was -> now'", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 48, testDate: "2026-06-01" }),
    ])
    expect(s.biggestMover!.test.previous).toBe(40)
    expect(s.biggestMover!.test.latest).toBe(48)
  })

  it("treats a SLOWER sprint as a decline", () => {
    const s = buildReportScores([
      pt({ testType: "sprint_10m", resultValue: 1.8, resultUnit: "s", testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-03-01" }),
    ])
    expect(s.tests[0].deltaPct).toBeLessThan(0)
  })

  it("scores a 1RM relative to body weight, and excludes it when body weight is missing", () => {
    const withBw = buildReportScores([
      pt({ testType: "back_squat_1rm", resultValue: 150, resultUnit: "kg", bodyWeightKg: 100, testDate: "2026-06-01" }),
    ])
    // back_squat_1rm range is 0.5-2.5 x bodyweight. 1.5x sits halfway → 50.
    expect(withBw.tests[0].score).toBe(50)

    const withoutBw = buildReportScores([
      pt({ testType: "back_squat_1rm", resultValue: 150, resultUnit: "kg", testDate: "2026-06-01" }),
    ])
    expect(withoutBw.tests[0].score).toBeNull()
    expect(withoutBw.categories).toEqual([])
    expect(withoutBw.athleteScore).toBeNull()
    // Still listed — an unscorable test must not vanish from the report.
    expect(withoutBw.tests).toHaveLength(1)
  })

  it("lists a custom test but never scores or judges it", () => {
    const s = buildReportScores([
      pt({ testType: "custom", customName: "Sled Push 20m", resultValue: 6.2, resultUnit: "s", testDate: "2026-06-01" }),
      pt({ testType: "custom", customName: "Sled Push 20m", resultValue: 5.9, resultUnit: "s", testDate: "2026-07-01" }),
    ])
    expect(s.tests).toHaveLength(1)
    expect(s.tests[0].label).toBe("Sled Push 20m")
    expect(s.tests[0].score).toBeNull()
    expect(s.tests[0].deltaPct).toBeNull()
    expect(s.categories).toEqual([])
    expect(s.biggestMover).toBeNull()
  })

  it("averages CATEGORIES not tests, so a lopsided history cannot skew the headline", () => {
    // Six sprints at the bottom of the range (score 0) + one jump at the top (100).
    // Averaging tests would give ~14. Averaging categories gives 50.
    const sprints: ReportTestPoint[] = ["2026-01-01", "2026-01-02", "2026-01-03"].flatMap((d) => [
      pt({ testType: "sprint_10m", resultValue: 2.5, resultUnit: "s", testDate: d }),
      pt({ testType: "sprint_20m", resultValue: 4.2, resultUnit: "s", testDate: d }),
    ])
    const s = buildReportScores([...sprints, pt({ testType: "cmj", resultValue: 65, testDate: "2026-01-01" })])
    expect(s.categories.map((c) => c.category).sort()).toEqual(["Power", "Speed"])
    expect(s.athleteScore).toBe(50)
    expect(s.strongest?.category).toBe("Power")
    expect(s.focalPoints[0]?.category).toBe("Speed")
  })

  it("keeps only the latest result per test type and exposes the full series for the sparkline", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 40, testDate: "2026-01-01" }),
      pt({ testType: "cmj", resultValue: 45, testDate: "2026-03-01" }),
      pt({ testType: "cmj", resultValue: 50, testDate: "2026-05-01", isPr: true }),
    ])
    expect(s.tests).toHaveLength(1)
    expect(s.tests[0].latest).toBe(50)
    expect(s.tests[0].latestDate).toBe("2026-05-01")
    expect(s.tests[0].isPr).toBe(true)
    expect(s.tests[0].points).toEqual([40, 45, 50])
  })

  it("sorts tests most-recently-tested first and categories strongest first", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 30, testDate: "2026-01-01" }),
      pt({ testType: "sprint_10m", resultValue: 1.6, resultUnit: "s", testDate: "2026-08-01" }),
    ])
    expect(s.tests.map((t) => t.testType)).toEqual(["sprint_10m", "cmj"])
    expect(s.categories[0].category).toBe("Speed")
  })

  it("names no focal point when only one category is scorable", () => {
    // One category means there is nothing to focus RELATIVE to — and the single
    // category is also the strongest, which must never be a focal point.
    const s = buildReportScores([pt({ testType: "cmj", resultValue: 45, testDate: "2026-06-01" })])
    expect(s.categories).toHaveLength(1)
    expect(s.focalPoints).toEqual([])
  })

  it("names one focal point when two categories are scorable, never the stronger", () => {
    const s = buildReportScores([
      // Power: cmj 65 = top of the 25-65 range = 100.
      pt({ testType: "cmj", resultValue: 65, testDate: "2026-06-01" }),
      // Mobility: sit_reach 10 of 0-40 = 25.
      pt({ testType: "sit_reach", resultValue: 10, testDate: "2026-06-01" }),
    ])
    expect(s.focalPoints).toHaveLength(1)
    expect(s.focalPoints[0].category).toBe("Mobility")
  })

  it("names the two lowest categories, lowest first, when three or more are scorable", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 65, testDate: "2026-06-01" }), // Power 100
      pt({ testType: "beep_test", resultValue: 11, testDate: "2026-06-01" }), // Endurance 67
      pt({ testType: "sit_reach", resultValue: 10, testDate: "2026-06-01" }), // Mobility 25
      pt({ testType: "sprint_10m", resultValue: 2.0, resultUnit: "s", testDate: "2026-06-01" }), // Speed 50
    ])
    expect(s.focalPoints.map((f) => f.category)).toEqual(["Mobility", "Speed"])
    expect(s.focalPoints[0].score).toBeLessThan(s.focalPoints[1].score)
  })

  it("blames the lowest-scoring test in the category, not just any member", () => {
    const s = buildReportScores([
      pt({ testType: "cmj", resultValue: 65, testDate: "2026-06-01" }), // Power 100
      // Strength: pull_up_max 20 of 0-25 = 80; push_up_max 15 of 10-80 = 7.
      pt({ testType: "pull_up_max", resultValue: 20, resultUnit: "reps", testDate: "2026-06-01" }),
      pt({ testType: "push_up_max", resultValue: 15, resultUnit: "reps", testDate: "2026-06-01" }),
    ])
    const strength = s.focalPoints.find((f) => f.category === "Strength")
    expect(strength).toBeDefined()
    expect(strength!.culprit.label).toBe("Push-up Max")
    expect(strength!.culprit.score).toBe(7)
  })

  it("returns no focal points for no tests", () => {
    expect(buildReportScores([]).focalPoints).toEqual([])
  })
})
