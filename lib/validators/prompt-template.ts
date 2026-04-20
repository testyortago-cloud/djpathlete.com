import { z } from "zod"

export const TEMPLATE_CATEGORIES = [
  "structure",
  "session",
  "periodization",
  "sport",
  "rehab",
  "conditioning",
  "specialty",
] as const

export const TEMPLATE_SCOPES = ["week", "day", "both"] as const

export const promptTemplateCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: z.enum(TEMPLATE_CATEGORIES),
  scope: z.enum(TEMPLATE_SCOPES),
  description: z.string().min(1, "Description is required").max(200),
  prompt: z.string().min(1, "Prompt is required").max(4000),
})

export const promptTemplateUpdateSchema = promptTemplateCreateSchema.partial()

export const enhanceRequestSchema = z.object({
  mode: z.enum(["polish", "generate"]),
  input: z.string().min(1).max(4000),
  target_scope: z.enum(["week", "day"]).optional(),
})

export type PromptTemplateCreateInput = z.infer<typeof promptTemplateCreateSchema>
export type PromptTemplateUpdateInput = z.infer<typeof promptTemplateUpdateSchema>
export type EnhanceRequest = z.infer<typeof enhanceRequestSchema>
