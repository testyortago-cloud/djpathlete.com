import { z } from "zod"

export const TEST_TYPES = [
  "drop_jump","cmj","squat_jump","broad_jump",
  "sprint_10m","sprint_20m","sprint_40m","sprint_5_10_5","t_test","beep_test",
  "sit_reach",
  "bench_press_1rm","back_squat_1rm","deadlift_1rm",
  "pull_up_max","push_up_max","plank_hold",
  "custom",
] as const

export const BEST_METHODS = ["highest", "lowest", "mean", "median"] as const

export const TEST_TYPE_LABELS: Record<(typeof TEST_TYPES)[number], string> = {
  drop_jump: "Drop Jump",
  cmj: "Countermovement Jump",
  squat_jump: "Squat Jump",
  broad_jump: "Broad Jump",
  sprint_10m: "10m Sprint",
  sprint_20m: "20m Sprint",
  sprint_40m: "40m Sprint",
  sprint_5_10_5: "5-10-5 Shuttle",
  t_test: "T-Test",
  beep_test: "Beep Test",
  sit_reach: "Sit & Reach",
  bench_press_1rm: "Bench Press 1RM",
  back_squat_1rm: "Back Squat 1RM",
  deadlift_1rm: "Deadlift 1RM",
  pull_up_max: "Pull-up Max",
  push_up_max: "Push-up Max",
  plank_hold: "Plank Hold",
  custom: "Custom Test",
}

type Default = { unit: string; best_method: (typeof BEST_METHODS)[number] }
export const TEST_TYPE_DEFAULTS: Record<(typeof TEST_TYPES)[number], Default> = {
  drop_jump: { unit: "cm", best_method: "highest" },
  cmj: { unit: "cm", best_method: "highest" },
  squat_jump: { unit: "cm", best_method: "highest" },
  broad_jump: { unit: "cm", best_method: "highest" },
  sprint_10m: { unit: "sec", best_method: "lowest" },
  sprint_20m: { unit: "sec", best_method: "lowest" },
  sprint_40m: { unit: "sec", best_method: "lowest" },
  sprint_5_10_5: { unit: "sec", best_method: "lowest" },
  t_test: { unit: "sec", best_method: "lowest" },
  beep_test: { unit: "level", best_method: "highest" },
  sit_reach: { unit: "cm", best_method: "highest" },
  bench_press_1rm: { unit: "kg", best_method: "highest" },
  back_squat_1rm: { unit: "kg", best_method: "highest" },
  deadlift_1rm: { unit: "kg", best_method: "highest" },
  pull_up_max: { unit: "reps", best_method: "highest" },
  push_up_max: { unit: "reps", best_method: "highest" },
  plank_hold: { unit: "sec", best_method: "highest" },
  custom: { unit: "", best_method: "highest" },
}

export function reduceTrials(values: number[], method: (typeof BEST_METHODS)[number]): number {
  if (values.length === 0) throw new Error("no trial values")
  switch (method) {
    case "highest":
      return Math.max(...values)
    case "lowest":
      return Math.min(...values)
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length
    case "median": {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }
  }
}

export const performanceTestFormSchema = z
  .object({
    test_type: z.enum(TEST_TYPES),
    custom_name: z.string().min(1).max(100).nullable(),
    result_value: z.number(),
    result_unit: z.string().min(1).max(20),
    trial_values: z.array(z.number()).max(20).nullable(),
    best_method: z.enum(BEST_METHODS),
    test_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    body_weight_kg: z.number().positive().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
    video_url: z.string().url().nullable(),
  })
  .refine((d) => !(d.test_type === "custom" && !d.custom_name), {
    message: "custom_name required when test_type='custom'",
    path: ["custom_name"],
  })

export type PerformanceTestFormData = z.infer<typeof performanceTestFormSchema>
