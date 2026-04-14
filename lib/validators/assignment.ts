import { z } from "zod"

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const assignmentSchema = z.object({
  user_ids: z.array(z.string().regex(uuidRegex, "Invalid ID")).min(1, "Select at least one client"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  notes: z
    .string()
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => v || null),
  complimentary: z.boolean().optional().default(false),
})

export type AssignmentFormData = z.infer<typeof assignmentSchema>
