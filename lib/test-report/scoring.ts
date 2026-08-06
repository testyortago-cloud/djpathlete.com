import { normalize, testDirection, RADAR_CATEGORIES, type RadarCategory } from "@/lib/coach-intel/test-normalization"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { TestType } from "@/types/database"

/**
 * A single logged test, scrubbed for the public report. Structurally a superset
 * of `RadarTestPoint` in lib/profile-share, so it can be handed straight to
 * `buildProgressions` without a second projection.
 */
export interface ReportTestPoint {
  testType: TestType
  resultValue: number
  resultUnit: string
  customName: string | null
  bodyWeightKg: number | null
  testDate: string
  isPr: boolean
}

export type Band = "strength" | "developing" | "priority"

/**
 * Band cut-points. The reference report publishes the labels but not the
 * thresholds, so these are DJP's own and deliberately easy to retune — they are
 * the only place a judgment of "good" is encoded.
 */
export const BAND_STRENGTH_MIN = 65
export const BAND_DEVELOPING_MIN = 40

export const BAND_LABELS: Record<Band, string> = {
  strength: "Strength",
  developing: "Developing",
  priority: "Priority",
}

export function bandFor(score: number): Band {
  if (score >= BAND_STRENGTH_MIN) return "strength"
  if (score >= BAND_DEVELOPING_MIN) return "developing"
  return "priority"
}

/** Fixed order so ties never reorder between renders. */
export const CATEGORY_ORDER: RadarCategory[] = ["Speed", "Power", "Strength", "Endurance", "Mobility"]

export interface ScoredTest {
  /** Test type, or `custom:<name>` — custom tests are grouped by their name. */
  key: string
  testType: TestType
  label: string
  latest: number
  unit: string
  latestDate: string
  isPr: boolean
  /** 0-100 against the reference range. null = unscorable (custom, or a 1RM with no body weight). */
  score: number | null
  /** Direction-aware % change vs the previous result. Positive always means better. */
  deltaPct: number | null
  /** Chronological values, oldest first. */
  points: number[]
}

export interface CategoryScore {
  category: RadarCategory
  score: number
  band: Band
  testLabels: string[]
}

export interface ReportScores {
  athleteScore: number | null
  /** Strongest first. Categories with no scorable test are absent entirely. */
  categories: CategoryScore[]
  strongest: CategoryScore | null
  focus: CategoryScore | null
  /** Latest result per test type, most recently tested first. */
  tests: ScoredTest[]
  biggestMover: { label: string; deltaPct: number } | null
}

function groupKey(t: ReportTestPoint): string {
  return t.testType === "custom" ? `custom:${t.customName ?? "Custom"}` : t.testType
}

function labelFor(t: ReportTestPoint): string {
  if (t.testType === "custom") return t.customName ?? "Custom Test"
  return TEST_TYPE_LABELS[t.testType] ?? t.testType
}

/**
 * Direction-aware change between the two most recent results. A sprint that got
 * faster returns a POSITIVE number: on this page, positive always means better.
 *
 * Derived from the series rather than read from `performance_tests.pct_change_from_prev`
 * — the stored column is raw-signed (a faster sprint stores a negative), so it
 * would need this flip applied anyway, and deriving keeps the number consistent
 * with the sparkline rendered beside it.
 */
function deltaFor(sorted: ReportTestPoint[]): number | null {
  if (sorted.length < 2) return null
  const latest = sorted[sorted.length - 1]
  const prev = sorted[sorted.length - 2]
  if (latest.testType === "custom") return null
  const direction = testDirection(latest.testType)
  if (direction === null || prev.resultValue === 0) return null
  const raw = ((latest.resultValue - prev.resultValue) / Math.abs(prev.resultValue)) * 100
  return Math.round(direction === "higher" ? raw : -raw)
}

/**
 * Everything the report judges, derived from the athlete's own logged tests.
 * Pure: no I/O, no clock. Unscorable tests stay in `tests` (a test the athlete
 * did must appear) but are excluded from every score.
 */
export function buildReportScores(points: ReportTestPoint[]): ReportScores {
  const byKey = new Map<string, ReportTestPoint[]>()
  for (const p of points) {
    const k = groupKey(p)
    const list = byKey.get(k)
    if (list) list.push(p)
    else byKey.set(k, [p])
  }

  const tests: ScoredTest[] = []
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.testDate.localeCompare(b.testDate))
    const latest = sorted[sorted.length - 1]
    tests.push({
      key,
      testType: latest.testType,
      label: labelFor(latest),
      latest: latest.resultValue,
      unit: latest.resultUnit,
      latestDate: latest.testDate,
      isPr: latest.isPr,
      score: latest.testType === "custom" ? null : normalize(latest.testType, latest.resultValue, latest.bodyWeightKg),
      deltaPct: deltaFor(sorted),
      points: sorted.map((t) => t.resultValue),
    })
  }
  tests.sort((a, b) => b.latestDate.localeCompare(a.latestDate))

  const categories: CategoryScore[] = []
  for (const category of CATEGORY_ORDER) {
    const members = tests.filter((t) => t.score !== null && RADAR_CATEGORIES[category].includes(t.testType))
    if (members.length === 0) continue
    const score = Math.round(members.reduce((sum, t) => sum + (t.score as number), 0) / members.length)
    categories.push({ category, score, band: bandFor(score), testLabels: members.map((t) => t.label) })
  }
  // Strongest first; CATEGORY_ORDER breaks ties because Array#sort is stable.
  categories.sort((a, b) => b.score - a.score)

  const athleteScore =
    categories.length > 0 ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length) : null

  const movers = tests.filter((t): t is ScoredTest & { deltaPct: number } => t.deltaPct !== null)
  const biggest = movers.reduce<(ScoredTest & { deltaPct: number }) | null>(
    (best, t) => (best === null || Math.abs(t.deltaPct) > Math.abs(best.deltaPct) ? t : best),
    null,
  )

  return {
    athleteScore,
    categories,
    strongest: categories[0] ?? null,
    focus: categories.length > 0 ? categories[categories.length - 1] : null,
    tests,
    biggestMover: biggest ? { label: biggest.label, deltaPct: biggest.deltaPct } : null,
  }
}
