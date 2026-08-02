import { testDirection } from "@/lib/coach-intel/test-normalization"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { TestType } from "@/types/database"
import type { RadarTestPoint } from "./data"

export interface TestProgression {
  key: string
  label: string
  unit: string
  /** Chronological result values (oldest → newest) for the sparkline. */
  points: number[]
  /** Same series with dates, for the detailed trend charts' tooltips. */
  series: { date: string; value: number }[]
  first: number
  latest: number
  latestDate: string
  /**
   * Direction-aware percent change first → latest. Positive = improved
   * (a faster sprint improves even though the raw number went down).
   * null when no judgment is possible (custom/unknown test, or first === 0).
   */
  improvementPct: number | null
}

const MAX_PROGRESSIONS = 6
const MIN_POINTS = 2

/**
 * Groups the public card's scrubbed test points into per-test progression
 * series. Only test types with ≥2 results qualify — one data point is a
 * record, not a progression. Most-improved first; unjudgeable (custom) series
 * sort last but still show their trend.
 */
export function buildProgressions(tests: RadarTestPoint[]): TestProgression[] {
  const byKey = new Map<string, RadarTestPoint[]>()
  for (const t of tests) {
    const key = t.testType === "custom" ? `custom:${t.customName ?? "Custom"}` : t.testType
    const list = byKey.get(key)
    if (list) list.push(t)
    else byKey.set(key, [t])
  }

  const progressions: TestProgression[] = []
  for (const [key, list] of byKey) {
    if (list.length < MIN_POINTS) continue
    const sorted = [...list].sort((a, b) => a.testDate.localeCompare(b.testDate))
    const first = sorted[0].resultValue
    const last = sorted[sorted.length - 1]
    const direction = last.testType === "custom" ? null : testDirection(last.testType as TestType)

    let improvementPct: number | null = null
    if (direction !== null && first !== 0) {
      const rawPct = ((last.resultValue - first) / Math.abs(first)) * 100
      improvementPct = Math.round(direction === "higher" ? rawPct : -rawPct)
    }

    progressions.push({
      key,
      label:
        last.testType === "custom" ? (last.customName ?? "Custom") : (TEST_TYPE_LABELS[last.testType] ?? last.testType),
      unit: last.resultUnit,
      points: sorted.map((t) => t.resultValue),
      series: sorted.map((t) => ({ date: t.testDate, value: t.resultValue })),
      first,
      latest: last.resultValue,
      latestDate: last.testDate,
      improvementPct,
    })
  }

  // Most-improved first; unjudgeable series last (still shown, never judged).
  return progressions
    .sort((a, b) => {
      if (a.improvementPct === null && b.improvementPct === null) return 0
      if (a.improvementPct === null) return 1
      if (b.improvementPct === null) return -1
      return b.improvementPct - a.improvementPct
    })
    .slice(0, MAX_PROGRESSIONS)
}
