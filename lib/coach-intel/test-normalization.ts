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

export function normalize(testType: TestType, value: number, bodyWeightKg?: number | null): number | null {
  const r = REFERENCE_RANGES[testType]
  if (!r) return null
  let v = value
  if (r.relativeToBodyWeight) {
    if (!bodyWeightKg || bodyWeightKg <= 0) return null
    v = value / bodyWeightKg
  }
  const clamped = Math.max(r.min, Math.min(r.max, v))
  const pct = (clamped - r.min) / (r.max - r.min)
  return Math.round((r.direction === "higher" ? pct : 1 - pct) * 100)
}
