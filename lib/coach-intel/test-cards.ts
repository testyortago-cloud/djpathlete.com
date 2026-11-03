import type { PerformanceTest, TestType } from "@/types/database"
import { TEST_TYPES, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"

export const TEST_GROUPS = [
  "Jumps",
  "Reactive strength",
  "Speed",
  "Strength & power",
  "Mobility",
  "Endurance",
  "Other",
] as const
export type TestGroup = (typeof TEST_GROUPS)[number]

/** Where each test sits on the Tests tab. A Record, so a new test type cannot be left out. */
const GROUP: Record<TestType, TestGroup> = {
  cmj: "Jumps",
  cmj_left: "Jumps",
  cmj_right: "Jumps",
  squat_jump: "Jumps",
  broad_jump: "Jumps",
  drop_jump: "Reactive strength",
  repeated_jumps: "Reactive strength",
  repeated_jumps_left: "Reactive strength",
  repeated_jumps_right: "Reactive strength",
  sprint_10m: "Speed",
  sprint_20m: "Speed",
  sprint_40m: "Speed",
  sprint_5_10_5: "Speed",
  t_test: "Speed",
  sprint_contact_left: "Speed",
  sprint_contact_right: "Speed",
  bench_press_1rm: "Strength & power",
  back_squat_1rm: "Strength & power",
  deadlift_1rm: "Strength & power",
  trap_bar_deadlift_1rm: "Strength & power",
  med_ball_squat_throw: "Strength & power",
  pull_up_max: "Strength & power",
  push_up_max: "Strength & power",
  sit_reach: "Mobility",
  torso_rotation_left: "Mobility",
  torso_rotation_right: "Mobility",
  beep_test: "Endurance",
  plank_hold: "Endurance",
  custom: "Other",
}

/** The other side of a left/right test (cmj_left -> cmj_right), or null for a two-sided one. */
export function otherSide(testType: TestType): TestType | null {
  const m = /^(.*)_(left|right)$/.exec(testType)
  if (!m) return null
  const other = `${m[1]}_${m[2] === "left" ? "right" : "left"}`
  return (TEST_TYPES as readonly string[]).includes(other) ? (other as TestType) : null
}

/** "Single-Leg CMJ (Left)" -> "Single-Leg CMJ". */
export function sidesLabel(testType: TestType): string {
  return TEST_TYPE_LABELS[testType].replace(/ \((Left|Right)\)$/, "")
}

export type TestCard =
  /** Every result of one test, newest first. */
  | { kind: "single"; key: string; history: PerformanceTest[] }
  /** Both sides of a left/right test, each newest first; a side never tested is []. */
  | { kind: "pair"; key: string; label: string; left: PerformanceTest[]; right: PerformanceTest[] }

/**
 * The Tests tab's cards: one per test (one per pair for a left/right test), grouped by
 * kind in TEST_GROUPS order, each group in the order TEST_TYPES lists its tests.
 */
export function testCards(tests: PerformanceTest[]): { group: TestGroup; cards: TestCard[] }[] {
  const newestFirst = [...tests].sort((a, b) => b.test_date.localeCompare(a.test_date))
  const cards = new Map<string, TestCard & { group: TestGroup; order: number }>()
  for (const test of newestFirst) {
    const group = GROUP[test.test_type] ?? "Other"
    const other = otherSide(test.test_type)
    if (other) {
      const left = test.test_type.endsWith("_left") ? test.test_type : other
      const key = `pair:${left.replace(/_left$/, "")}`
      const card = cards.get(key) ?? {
        kind: "pair" as const,
        key,
        label: sidesLabel(left),
        left: [],
        right: [],
        group,
        order: TEST_TYPES.indexOf(left),
      }
      if (card.kind === "pair") (test.test_type === left ? card.left : card.right).push(test)
      cards.set(key, card)
      continue
    }
    const key = test.test_type === "custom" ? `custom:${test.custom_name}` : test.test_type
    const card = cards.get(key) ?? {
      kind: "single" as const,
      key,
      history: [],
      group,
      order: TEST_TYPES.indexOf(test.test_type),
    }
    if (card.kind === "single") card.history.push(test)
    cards.set(key, card)
  }

  return TEST_GROUPS.map((group) => ({
    group,
    cards: [...cards.values()]
      .filter((c) => c.group === group)
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
      .map(({ group: _group, order: _order, ...card }) => card as TestCard),
  })).filter((g) => g.cards.length > 0)
}

/**
 * A difference this large between legs is worth a look. ponytail: one fixed line (the usual
 * 10-15% rule of thumb); make it a per-coach setting if Darren wants his own.
 */
export const SIDE_GAP_FLAG_PCT = 15

/**
 * How far apart the two sides' results are, as a % of the larger one, and which side is
 * weaker (the lower one, or the slower one for a lower-is-better test). Only for results
 * from the same day: comparing a left leg in March with a right leg in June says nothing.
 */
export function sideGap(
  left: PerformanceTest | undefined,
  right: PerformanceTest | undefined,
): { pct: number; weaker: "left" | "right" | null } | null {
  if (!left || !right || left.test_date !== right.test_date) return null
  const l = Number(left.result_value)
  const r = Number(right.result_value)
  if (l === r || !Math.max(l, r)) return { pct: 0, weaker: null }
  const leftWeaker = left.best_method === "lowest" ? l > r : l < r
  return { pct: Math.round((Math.abs(l - r) / Math.max(l, r)) * 100), weaker: leftWeaker ? "left" : "right" }
}
