import type { BestMethod, TestType } from "@/types/database"
import { TEST_TYPE_DEFAULTS, reduceTrials } from "@/lib/validators/performance-test"

/** One result from POST /api/v1/exercises/measurements (fields we read). */
export interface OutputMeasurement {
  id: string
  athleteId: string
  exerciseId: string
  exerciseCategory: string
  completedDate: string
  variant: string | null
  metrics: { field: string; value: number }[]
}

/** A performance_tests row built from a day of Output results. */
export interface ImportRow {
  output_key: string
  test_type: TestType
  test_date: string
  result_value: number
  result_unit: string
  trial_values: number[]
  best_method: BestMethod
  notes: string
}

interface Mapping {
  testType: TestType
  field: string
  /** Output reports metres; the app's jumps are in cm. */
  scale: number
  decimals: number
  note?: string
}

const jump = (testType: TestType, field = "jumpHeight"): Mapping => ({ testType, field, scale: 100, decimals: 1 })
const timed = (testType: TestType): Mapping => ({ testType, field: "duration", scale: 1, decimals: 2 })
const lift = (testType: TestType): Mapping => ({
  testType,
  field: "estimatedOneRepMax",
  scale: 1,
  decimals: 1,
  note: "1RM estimated by Output from bar speed",
})

/**
 * Output exercises that match a test the app already tracks, keyed by exercise id, or by
 * `id:variant` for a one-sided exercise (Output records each leg as its own result with
 * variant "Left" or "Right"). Anything else (mobility, hops, throws, other lifts) stays
 * in Output: the app's "custom" test type is a single bucket, so importing them would mix
 * unrelated exercises into one history.
 */
const MAPPINGS: Record<string, Mapping> = {
  BILATERAL_CMJ: jump("cmj"),
  "UNILATERAL_CMJ:Left": jump("cmj_left"),
  "UNILATERAL_CMJ:Right": jump("cmj_right"),
  SQUAT_JUMP: jump("squat_jump"),
  BILATERAL_DROP_JUMP: jump("drop_jump"),
  BILATERAL_BROAD_JUMP_INPUT: jump("broad_jump", "jumpDistance"),
  "10_METRE_TIME_INPUT": timed("sprint_10m"),
  "20_METRE_TIME_INPUT": timed("sprint_20m"),
  "20_METRE_SPEED": timed("sprint_20m"),
  "40_METRE_TIME_INPUT": timed("sprint_40m"),
  "40_METRE_SPEED": timed("sprint_40m"),
  "5_10_5_AGILITY_TEST_INPUT": timed("sprint_5_10_5"),
  T_TEST_AGILITY: timed("t_test"),
  BARBELL_BACK_SQUAT: lift("back_squat_1rm"),
  BARBELL_BENCH_PRESS: lift("bench_press_1rm"),
  BARBELL_DEADLIFT: lift("deadlift_1rm"),
}

/** YYYY-MM-DD of an instant in `timeZone`, or in UTC when the zone is unknown. */
export function localDate(iso: string, timeZone: string): string {
  const d = new Date(iso)
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

const round = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals

/**
 * Groups Output results into one performance test per test type per day: every
 * measurement is a trial, and the result is the best of them by the test's own
 * direction (highest jump, fastest sprint). `athleteId`, when given, drops anything
 * recorded for someone else, so a filter Output ignores can never import another
 * athlete's results.
 */
export function measurementsToTests(
  measurements: OutputMeasurement[],
  timeZone: string,
  athleteId?: string,
): { rows: ImportRow[]; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {}
  const groups = new Map<string, { mapping: Mapping; date: string; trials: number[]; extra: string[] }>()
  const sorted = [...measurements].sort((a, b) => a.completedDate.localeCompare(b.completedDate))

  for (const ms of sorted) {
    if (athleteId && ms.athleteId !== athleteId) continue
    const mapping = MAPPINGS[`${ms.exerciseId}:${ms.variant}`] ?? MAPPINGS[ms.exerciseId]
    const raw = mapping ? ms.metrics.find((x) => x.field === mapping.field)?.value : undefined
    if (!mapping || typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      const category = ms.exerciseCategory || "Other"
      skipped[category] = (skipped[category] ?? 0) + 1
      continue
    }
    const date = localDate(ms.completedDate, timeZone)
    const key = `${mapping.testType}:${date}`
    const group = groups.get(key) ?? { mapping, date, trials: [], extra: [] }
    group.trials.push(round(raw * mapping.scale, mapping.decimals))
    const rsi = ms.metrics.find((x) => x.field === "rsi")?.value
    if (mapping.testType === "drop_jump" && typeof rsi === "number") group.extra.push(`RSI ${rsi.toFixed(2)}`)
    groups.set(key, group)
  }

  const rows = [...groups.entries()].map(([key, g]): ImportRow => {
    const { unit, best_method } = TEST_TYPE_DEFAULTS[g.mapping.testType]
    const notes = ["Imported from Output Sports", g.mapping.note, g.extra.length ? g.extra.join(", ") : undefined]
    return {
      output_key: key,
      test_type: g.mapping.testType,
      test_date: g.date,
      result_value: reduceTrials(g.trials, best_method),
      result_unit: unit,
      trial_values: g.trials,
      best_method,
      notes: notes.filter(Boolean).join(". "),
    }
  })
  return { rows, skipped }
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase()

/**
 * Whether an Output athlete looks like this client, to suggest the link: the same full
 * name, or the same surname and date of birth. A suggestion only; the coach confirms it.
 */
export function looksLikeClient(
  athlete: { firstName: string | null; lastName: string | null; fullName: string | null; dateOfBirth: string | null },
  client: { first_name: string | null; last_name: string | null; date_of_birth: string | null },
): boolean {
  const clientName = norm(`${client.first_name ?? ""} ${client.last_name ?? ""}`)
  const athleteName = norm(athlete.fullName) || norm(`${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`)
  if (clientName && clientName === athleteName) return true
  const sameDob = !!client.date_of_birth && athlete.dateOfBirth?.slice(0, 10) === client.date_of_birth.slice(0, 10)
  return sameDob && !!norm(client.last_name) && norm(client.last_name) === norm(athlete.lastName)
}

const DAY_MS = 86_400_000
/** Output answers at most 31 days per request. */
export function syncWindows(from: Date, to: Date): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = []
  for (let start = from; start < to; ) {
    const end = new Date(Math.min(start.getTime() + 31 * DAY_MS, to.getTime()))
    windows.push({ start, end })
    start = end
  }
  return windows
}
