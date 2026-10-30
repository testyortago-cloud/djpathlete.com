import type { TestType } from "@/types/database"

interface Range {
  min: number
  max: number
  direction: "higher" | "lower"
  relativeToBodyWeight?: boolean
}

const REFERENCE_RANGES: Partial<Record<TestType, Range>> = {
  drop_jump: { min: 20, max: 60, direction: "higher" },
  cmj: { min: 25, max: 65, direction: "higher" },
  squat_jump: { min: 22, max: 55, direction: "higher" },
  broad_jump: { min: 180, max: 320, direction: "higher" },
  sprint_10m: { min: 1.5, max: 2.5, direction: "lower" },
  sprint_20m: { min: 2.5, max: 4.2, direction: "lower" },
  sprint_40m: { min: 4.5, max: 7.0, direction: "lower" },
  sprint_5_10_5: { min: 4.0, max: 6.5, direction: "lower" },
  t_test: { min: 9.0, max: 14.0, direction: "lower" },
  beep_test: { min: 5, max: 14, direction: "higher" },
  sit_reach: { min: 0, max: 40, direction: "higher" },
  bench_press_1rm: { min: 0.5, max: 2.0, direction: "higher", relativeToBodyWeight: true },
  back_squat_1rm: { min: 0.5, max: 2.5, direction: "higher", relativeToBodyWeight: true },
  deadlift_1rm: { min: 0.5, max: 3.0, direction: "higher", relativeToBodyWeight: true },
  pull_up_max: { min: 0, max: 25, direction: "higher" },
  push_up_max: { min: 10, max: 80, direction: "higher" },
  plank_hold: { min: 30, max: 240, direction: "higher" },
}

export type RadarCategory = "Speed" | "Power" | "Strength" | "Endurance" | "Mobility"

export const RADAR_CATEGORIES: Record<RadarCategory, TestType[]> = {
  Speed: ["sprint_10m", "sprint_20m", "sprint_40m", "sprint_5_10_5", "t_test"],
  Power: ["drop_jump", "cmj", "squat_jump", "broad_jump"],
  Strength: ["bench_press_1rm", "back_squat_1rm", "deadlift_1rm", "pull_up_max", "push_up_max"],
  Endurance: ["beep_test", "plank_hold"],
  Mobility: ["sit_reach"],
}

/**
 * Which way "better" points for a test type — sprints improve downward,
 * jumps upward. null for custom/unknown types: no judgment can be made.
 */
export function testDirection(testType: TestType): "higher" | "lower" | null {
  return REFERENCE_RANGES[testType]?.direction ?? null
}

/**
 * The score a result exactly AT the Trained standard gets. It is where the green
 * "Strength" band starts (BAND_STRENGTH_MIN), so hitting Trained reads as green.
 */
export const TRAINED_SCORE = 65

/**
 * The three numbers a result is judged against, in the test's own units (multiples
 * of body weight for the 1RM tests). `floor` scores 0, `trained` TRAINED_SCORE,
 * `elite` 100; for a "lower" test (sprints) floor > trained > elite.
 */
export interface Standard {
  floor: number
  trained: number
  elite: number
  direction: "higher" | "lower"
  relativeToBodyWeight: boolean
}

/** A coach's own standard row (performance_standards); age_min/age_max null = all ages. */
export interface StandardRow {
  test_type: string
  age_min: number | null
  age_max: number | null
  floor_value: number
  trained_value: number
  elite_value: number
}

/** Only the numbers of a coach's rows, never their ids or business id: what a page may send to the browser. */
export function standardNumbers(rows: readonly StandardRow[]): StandardRow[] {
  return rows.map(({ test_type, age_min, age_max, floor_value, trained_value, elite_value }) => ({
    test_type,
    age_min,
    age_max,
    floor_value,
    trained_value,
    elite_value,
  }))
}

/** The built-in standard: the worse end of the reference range, its middle, and its better end. */
export function defaultStandard(testType: TestType): Standard | null {
  const r = REFERENCE_RANGES[testType]
  if (!r) return null
  const higher = r.direction === "higher"
  return {
    floor: higher ? r.min : r.max,
    trained: (r.min + r.max) / 2,
    elite: higher ? r.max : r.min,
    direction: r.direction,
    relativeToBodyWeight: r.relativeToBodyWeight ?? false,
  }
}

/**
 * The standard a client is judged by: the coach's narrowest age group containing
 * their age, else the coach's all-ages row, else the built-in one. A custom test
 * has none (null): there is no direction to judge it by.
 */
export function pickStandard(
  rows: readonly StandardRow[] | null | undefined,
  testType: TestType,
  age: number | null,
): Standard | null {
  const base = defaultStandard(testType)
  if (!base) return null
  const forTest = (rows ?? []).filter((r) => r.test_type === testType)
  const isAllAges = (r: StandardRow) => r.age_min == null && r.age_max == null
  const width = (r: StandardRow) => (r.age_max ?? 200) - (r.age_min ?? 0)
  const band =
    age == null
      ? undefined
      : forTest
          .filter((r) => !isAllAges(r) && (r.age_min ?? 0) <= age && age <= (r.age_max ?? 200))
          .sort((a, b) => width(a) - width(b))[0]
  const row = band ?? forTest.find(isAllAges)
  if (!row) return base
  return { ...base, floor: Number(row.floor_value), trained: Number(row.trained_value), elite: Number(row.elite_value) }
}

/** Why a coach's three numbers are out of order for this test; null when they are in order. */
export function standardOrderProblem(testType: TestType, floor: number, trained: number, elite: number): string | null {
  const base = defaultStandard(testType)
  if (!base) return "This test has no standards."
  if (base.direction === "higher") {
    return floor < trained && trained < elite
      ? null
      : "Starting point, Trained and Elite must go up: Elite is the best result."
  }
  return floor > trained && trained > elite
    ? null
    : "Lower is better for this test: Starting point, Trained and Elite must go down."
}

/** The test types a coach can set standards for: those with a built-in reference range. */
export const STANDARD_TEST_TYPES = Object.keys(REFERENCE_RANGES) as TestType[]

export interface ReferenceTargets {
  /** Top of the reference range — the standard an elite performer is at. */
  elite: number
  /** Midpoint — a well-trained athlete's standard. */
  trained: number
  /** True when both figures are multiples of body weight, not absolute values. */
  relativeToBodyWeight: boolean
  direction: "higher" | "lower"
}

/**
 * The two coaching standards the test report compares an athlete against: the
 * coach's own (performance_standards, via pickStandard) or the built-in ones.
 *
 * These are coaching reference points, NOT measured population data — the app
 * has no norms table, so nothing here may be labelled a percentile or a
 * "professional average". `elite` is the better end (so for a sprint the FASTER one).
 *
 * When `relativeToBodyWeight`, the figures are multiples of body weight; passing
 * a body weight converts them to absolute units. Without one, a bodyweight-
 * relative test returns null rather than a misleading absolute number.
 */
export function referenceTargets(
  testType: TestType,
  bodyWeightKg?: number | null,
  standard: Standard | null = defaultStandard(testType),
): ReferenceTargets | null {
  if (!standard) return null
  let { elite, trained } = standard
  if (standard.relativeToBodyWeight) {
    if (!bodyWeightKg || bodyWeightKg <= 0) return null
    elite *= bodyWeightKg
    trained *= bodyWeightKg
  }
  return {
    elite: Math.round(elite * 100) / 100,
    trained: Math.round(trained * 100) / 100,
    relativeToBodyWeight: standard.relativeToBodyWeight,
    direction: standard.direction,
  }
}

/**
 * A result as a 0-100 score against a standard: 0 at or past the floor, TRAINED_SCORE
 * at Trained, 100 at or past Elite, in straight lines between.
 */
export function normalize(
  testType: TestType,
  value: number,
  bodyWeightKg?: number | null,
  standard: Standard | null = defaultStandard(testType),
): number | null {
  if (!standard) return null
  let v = value
  if (standard.relativeToBodyWeight) {
    if (!bodyWeightKg || bodyWeightKg <= 0) return null
    v = value / bodyWeightKg
  }
  // Flip a "lower is better" test so bigger always means better below.
  const s = standard.direction === "higher" ? 1 : -1
  const [x, floor, trained, elite] = [v * s, standard.floor * s, standard.trained * s, standard.elite * s]
  if (x >= elite) return 100
  if (x >= trained) return Math.round(TRAINED_SCORE + ((100 - TRAINED_SCORE) * (x - trained)) / (elite - trained))
  if (x <= floor) return 0
  return Math.round((TRAINED_SCORE * (x - floor)) / (trained - floor))
}
