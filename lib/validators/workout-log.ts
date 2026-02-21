import { z } from "zod"

// Accepts any UUID-formatted hex string (including seed IDs without v4 version bits)
const uuidLike = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid ID format"
)

export const setDetailSchema = z.object({
  set_number: z.number().int().min(1).max(20),
  weight_kg: z.number().min(0).nullable().optional().transform((v) => v ?? null),
  reps: z.number().int().min(0).max(999),
  rpe: z.number().int().min(1).max(10).nullable().optional().transform((v) => v ?? null),
})

export type SetDetailData = z.infer<typeof setDetailSchema>

export const workoutLogSchema = z.object({
  exercise_id: uuidLike,
  assignment_id: uuidLike.nullable().optional().transform((v) => v ?? null),
  sets_completed: z.number().int().min(1).max(20),
  reps_completed: z.string().min(1).max(50),
  weight_kg: z.number().min(0).nullable().optional().transform((v) => v ?? null),
  rpe: z.number().int().min(1).max(10).nullable().optional().transform((v) => v ?? null),
  duration_seconds: z.number().int().min(0).nullable().optional().transform((v) => v ?? null),
  notes: z.string().max(500).nullable().optional().transform((v) => v || null),
  set_details: z.array(setDetailSchema).min(1).max(20).nullable().optional().transform((v) => v ?? null),
  ai_next_weight_kg: z.number().min(0).nullable().optional().transform((v) => v ?? null),
})

export type WorkoutLogFormData = z.infer<typeof workoutLogSchema>
