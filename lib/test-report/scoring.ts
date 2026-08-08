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
  /** The result before `latest`, for the "previous → now" comparison. null on a first test. */
  previous: number | null
  /** Chronological values, oldest first. */
  points: number[]
}

export interface CategoryScore {
  category: RadarCategory
  score: number
  band: Band
}

/**
 * A category worth training, plus the specific test dragging its average down.
 *
 * The abstract number ("Speed 54") is not actionable on its own — `culprit` is
 * what turns it into something the athlete can go and do.
 */
export interface FocalPoint {
  category: RadarCategory
  score: number
  band: Band
  culprit: ScoredTest
}

/**
 * The hero of page 1.
 *
 * Prefers the biggest IMPROVEMENT, so the page normally opens on something the
 * athlete did well. Falls back to the largest decline only when nothing improved
 * — a report that can only ever show good news is not worth trusting, and every
 * decline stays visible in the page-2 rows regardless.
 */
export interface BiggestMover {
  test: ScoredTest & { deltaPct: number; previous: number }
  /**
   * Three states, because a boolean cannot carry three. `flat` happens when every
   * test's change rounds to zero — the page must not call that an improvement.
   */
  direction: "improved" | "flat" | "declined"
}

export interface ReportScores {
  athleteScore: number | null
  /** Strongest first. Categories with no scorable test are absent entirely. */
  categories: CategoryScore[]
  strongest: CategoryScore | null
  /**
   * The categories to train next, lowest first. NEVER includes the top-ranked
   * category — labelling an athlete's best quality a "focal point" is wrong, and
   * it is exactly what a naive "take the last two" produces when there are only
   * two categories. Empty when fewer than two categories are scorable.
   */
  focalPoints: FocalPoint[]
  /** Latest result per test type, most recently tested first. */
  tests: ScoredTest[]
  biggestMover: BiggestMover | null
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
 * The weakest member of a category. Ties resolve to the most recently tested,
 * because `tests` is already sorted by date descending and `reduce` keeps the
 * incumbent on a tie — so the result is deterministic between renders.
 */
function lowestScoring(members: ScoredTest[]): ScoredTest {
  return members.reduce((low, t) => ((t.score as number) < (low.score as number) ? t : low))
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
      previous: sorted.length > 1 ? sorted[sorted.length - 2].resultValue : null,
      points: sorted.map((t) => t.resultValue),
    })
  }
  tests.sort((a, b) => b.latestDate.localeCompare(a.latestDate))

  const categories: CategoryScore[] = []
  const membersByCategory = new Map<RadarCategory, ScoredTest[]>()
  for (const category of CATEGORY_ORDER) {
    const members = tests.filter((t) => t.score !== null && RADAR_CATEGORIES[category].includes(t.testType))
    if (members.length === 0) continue
    membersByCategory.set(category, members)
    const score = Math.round(members.reduce((sum, t) => sum + (t.score as number), 0) / members.length)
    categories.push({ category, score, band: bandFor(score) })
  }
  // Strongest first; CATEGORY_ORDER breaks ties because Array#sort is stable.
  categories.sort((a, b) => b.score - a.score)

  // max(0, …) is load-bearing: `categories.length - 1` is -1 on an empty list, and
  // a negative count would make the slice below take from the wrong end.
  const focalCount = Math.max(0, Math.min(2, categories.length - 1))
  const focalPoints: FocalPoint[] = categories
    .slice(categories.length - focalCount)
    .reverse()
    .map((c) => ({
      category: c.category,
      score: c.score,
      band: c.band,
      culprit: lowestScoring(membersByCategory.get(c.category) as ScoredTest[]),
    }))

  const athleteScore =
    categories.length > 0 ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length) : null

  // deltaPct and previous are both non-null exactly when a test has >= 2 results,
  // so this predicate narrows both at once rather than asserting one from the other.
  const movers = tests.filter(
    (t): t is ScoredTest & { deltaPct: number; previous: number } => t.deltaPct !== null && t.previous !== null,
  )
  const improved = movers.filter((t) => t.deltaPct > 0)
  const pool = improved.length > 0 ? improved : movers
  // Ties resolve to the most recently tested, because `tests` is already sorted by date descending
  // and `reduce` keeps the incumbent on a strict `>` — so the result is deterministic between renders.
  const best = pool.reduce<(ScoredTest & { deltaPct: number; previous: number }) | null>(
    (b, t) => (b === null || Math.abs(t.deltaPct) > Math.abs(b.deltaPct) ? t : b),
    null,
  )
  const direction = best === null ? null : best.deltaPct > 0 ? "improved" : best.deltaPct < 0 ? "declined" : "flat"

  return {
    athleteScore,
    categories,
    strongest: categories[0] ?? null,
    focalPoints,
    tests,
    biggestMover: best && direction ? { test: best, direction } : null,
  }
}
