import { z } from "zod"

export const PROGRAM_CATEGORIES = [
  "strength",
  "conditioning",
  "sport_specific",
  "recovery",
  "nutrition",
  "hybrid",
] as const

export const PROGRAM_DIFFICULTIES = [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
] as const

export const SPLIT_TYPES = [
  "full_body",
  "upper_lower",
  "push_pull_legs",
  "push_pull",
  "body_part",
  "movement_pattern",
  "custom",
] as const

export const PERIODIZATION_TYPES = [
  "linear",
  "undulating",
  "block",
  "reverse_linear",
  "none",
] as const

export const programFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be under 100 characters"),
  description: z
    .string()
    .max(2000, "Description must be under 2000 characters")
    .nullable()
    .transform((v) => v || null),
  category: z.array(z.enum(PROGRAM_CATEGORIES)).min(1, "Select at least one category"),
  difficulty: z.enum(PROGRAM_DIFFICULTIES, {
    message: "Difficulty is required",
  }),
  duration_weeks: z.coerce
    .number()
    .int("Must be a whole number")
    .positive("Must be at least 1 week"),
  sessions_per_week: z.coerce
    .number()
    .int("Must be a whole number")
    .positive("Must be at least 1 session"),
  price_cents: z.coerce
    .number()
    .int("Must be a whole number")
    .positive("Must be greater than 0")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  split_type: z.enum(SPLIT_TYPES).nullable().optional().transform((v) => v ?? null),
  periodization: z.enum(PERIODIZATION_TYPES).nullable().optional().transform((v) => v ?? null),
  is_public: z.boolean().optional().default(false),
})

export type ProgramFormData = z.infer<typeof programFormSchema>
