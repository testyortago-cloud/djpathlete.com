import { z } from "zod"
import { SPLIT_TYPES, PERIODIZATION_TYPES } from "./program"

export const aiGenerationRequestSchema = z.object({
  client_id: z.string().uuid("Invalid client ID"),
  goals: z.array(z.string().min(1)).min(1, "At least one goal is required"),
  duration_weeks: z.coerce.number().int().min(1).max(52),
  sessions_per_week: z.coerce.number().int().min(1).max(7),
  session_minutes: z.coerce.number().int().min(15).max(180).optional(),
  split_type: z.enum(SPLIT_TYPES).optional(),
  periodization: z.enum(PERIODIZATION_TYPES).optional(),
  additional_instructions: z.string().max(2000).optional(),
  equipment_override: z.array(z.string()).optional(),
  is_public: z.boolean().optional(),
})

export type AiGenerationRequest = z.infer<typeof aiGenerationRequestSchema>
