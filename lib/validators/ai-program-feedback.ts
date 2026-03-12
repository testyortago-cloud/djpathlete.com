import { z } from "zod"

export const programIssueCategorySchema = z.enum([
  "push_pull_imbalance",
  "missing_movement_pattern",
  "wrong_difficulty",
  "bad_exercise_choice",
  "too_many_exercises",
  "periodization_issue",
  "equipment_mismatch",
  "other",
])

export const programFeedbackIssueSchema = z.object({
  category: programIssueCategorySchema,
  description: z.string().min(1).max(1000),
  severity: z.enum(["low", "medium", "high"]),
})

export const programFeedbackSubmitSchema = z.object({
  overall_rating: z.number().int().min(1).max(5),
  balance_quality: z.number().int().min(1).max(5).optional(),
  exercise_selection_quality: z.number().int().min(1).max(5).optional(),
  periodization_quality: z.number().int().min(1).max(5).optional(),
  difficulty_appropriateness: z.number().int().min(1).max(5).optional(),
  specific_issues: z.array(programFeedbackIssueSchema).default([]),
  corrections_made: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(5000).optional(),
})

export type ProgramFeedbackSubmitInput = z.infer<typeof programFeedbackSubmitSchema>
