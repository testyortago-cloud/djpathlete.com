import { z } from "zod"

export const ASSESSMENT_SECTIONS = ["movement_screen", "background", "context", "preferences"] as const

export const ASSESSMENT_QUESTION_TYPES = ["yes_no", "single_select", "multi_select", "number", "text"] as const

export const ASSESSMENT_TYPES = ["initial", "reassessment"] as const

export const ABILITY_LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const

export const SECTION_LABELS: Record<string, string> = {
  movement_screen: "Movement Screen",
  background: "Background",
  context: "Context",
  preferences: "Preferences",
}

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  yes_no: "Yes / No",
  single_select: "Single Select",
  multi_select: "Multi Select",
  number: "Number",
  text: "Text",
}

export const ABILITY_LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

// Schema for creating/updating an assessment question (admin)
export const assessmentQuestionSchema = z.object({
  section: z.enum(ASSESSMENT_SECTIONS, {
    message: "Please select a valid section",
  }),
  movement_pattern: z
    .string()
    .max(100, "Movement pattern must be under 100 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
  question_text: z
    .string()
    .min(3, "Question text must be at least 3 characters")
    .max(1000, "Question text must be under 1000 characters"),
  question_type: z.enum(ASSESSMENT_QUESTION_TYPES, {
    message: "Please select a valid question type",
  }),
  options: z
    .array(
      z.object({
        value: z.string().min(1, "Option value is required"),
        label: z.string().min(1, "Option label is required"),
      }),
    )
    .nullable()
    .optional()
    .transform((v) => v || null),
  parent_question_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((v) => v || null),
  parent_answer: z
    .string()
    .max(200, "Parent answer must be under 200 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
  level_impact: z
    .record(z.string(), z.number())
    .nullable()
    .optional()
    .transform((v) => v || null),
  order_index: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
})

export type AssessmentQuestionFormData = z.infer<typeof assessmentQuestionSchema>

// Schema for submitting assessment answers (client)
export const assessmentSubmitSchema = z.object({
  assessment_type: z.enum(ASSESSMENT_TYPES, {
    message: "Please select a valid assessment type",
  }),
  answers: z.record(z.string().uuid(), z.string(), {
    message: "Answers must be a map of question ID to answer value",
  }),
  feedback: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .transform((v) => v || null),
})

export type AssessmentSubmitData = z.infer<typeof assessmentSubmitSchema>

// Schema for reordering questions (admin)
export const assessmentReorderSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().uuid(),
        order_index: z.number().int().min(0),
      }),
    )
    .min(1, "At least one update is required"),
})

export type AssessmentReorderData = z.infer<typeof assessmentReorderSchema>
