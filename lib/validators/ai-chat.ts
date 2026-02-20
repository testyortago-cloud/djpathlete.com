import { z } from "zod"
import {
  AI_CHAT_MAX_MESSAGES,
  AI_CHAT_MAX_MESSAGE_LENGTH,
} from "@/lib/admin-ai-config"

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(AI_CHAT_MAX_MESSAGE_LENGTH),
})

export const aiChatSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(AI_CHAT_MAX_MESSAGES),
  model: z.enum(["sonnet", "haiku", "auto"]).optional().default("auto"),
})

export type ChatMessage = z.infer<typeof chatMessageSchema>
export type AiChatRequest = z.infer<typeof aiChatSchema>
