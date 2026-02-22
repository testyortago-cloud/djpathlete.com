import { z } from "zod"

export const createTrackedExerciseSchema = z.object({
  assignment_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid ID"),
  exercise_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid ID"),
  target_metric: z.enum(["weight", "reps", "time"]).default("weight"),
  notes: z.string().max(500).nullable().optional().transform((v) => v || null),
})

export type CreateTrackedExerciseData = z.infer<
  typeof createTrackedExerciseSchema
>
