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
  category: z.enum(PROGRAM_CATEGORIES, {
    message: "Category is required",
  }),
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
})

export type ProgramFormData = z.infer<typeof programFormSchema>
