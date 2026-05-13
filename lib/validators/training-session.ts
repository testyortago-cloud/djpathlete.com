import { z } from "zod"

export const SESSION_TYPES = [
  "gym",
  "sport",
  "field",
  "conditioning",
  "mobility",
  "other",
] as const

export const SESSION_TYPE_LABELS: Record<(typeof SESSION_TYPES)[number], string> = {
  gym: "Gym",
  sport: "Sport practice",
  field: "Field",
  conditioning: "Conditioning",
  mobility: "Mobility",
  other: "Other",
}

export const trainingSessionFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  session_type: z.enum(SESSION_TYPES),
  rpe: z.number().int().min(1).max(10),
  duration_min: z.number().int().min(1).max(600),
  notes: z.string().max(1000).nullable(),
  program_assignment_id: z.string().uuid().nullable(),
})

export type TrainingSessionFormData = z.infer<typeof trainingSessionFormSchema>
