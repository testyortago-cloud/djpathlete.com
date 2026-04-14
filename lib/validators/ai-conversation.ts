import { z } from "zod"

export const aiFeatureSchema = z.enum(["program_generation", "program_chat", "admin_chat", "ai_coach"])

export const aiMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"])

export const conversationMessageSchema = z.object({
  user_id: z.string().uuid(),
  feature: aiFeatureSchema,
  session_id: z.string().min(1),
  role: aiMessageRoleSchema,
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tokens_input: z.number().int().nullable().default(null),
  tokens_output: z.number().int().nullable().default(null),
  model_used: z.string().nullable().default(null),
})

export type ConversationMessageInput = z.infer<typeof conversationMessageSchema>
