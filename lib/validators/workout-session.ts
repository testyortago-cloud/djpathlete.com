import { z } from "zod"

export const ensureSessionSchema = z.object({
  assignment_id: z.string().uuid(),
  week_number: z.number().int().min(1),
  day_of_week: z.number().int().min(0).max(7),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  prs: z.number().int().min(0).max(10).nullable().optional(),
})

export const finishSessionSchema = z.object({
  session_id: z.string().uuid(),
  session_rpe: z.number().int().min(1).max(10),
  volume_load_kg: z.number().min(0).nullable().optional(),
  duration_seconds: z.number().int().min(0).max(86400).nullable().optional(),
})

export type EnsureSessionInput = z.infer<typeof ensureSessionSchema>
export type FinishSessionInput = z.infer<typeof finishSessionSchema>
