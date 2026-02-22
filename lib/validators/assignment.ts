import { z } from "zod"

export const assignmentSchema = z.object({
  user_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid ID"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  notes: z.string().max(1000).nullable().optional().transform((v) => v || null),
})

export type AssignmentFormData = z.infer<typeof assignmentSchema>
