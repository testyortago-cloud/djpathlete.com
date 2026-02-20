import { z } from "zod"

export const createTrackedExerciseSchema = z.object({
  assignment_id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  target_metric: z.enum(["weight", "reps", "time"]).default("weight"),
  notes: z.string().max(500).nullable().optional().transform((v) => v || null),
})

export type CreateTrackedExerciseData = z.infer<
  typeof createTrackedExerciseSchema
>
