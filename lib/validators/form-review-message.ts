import { z } from "zod"

const AUDIO_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const

const audioAttachmentSchema = z.object({
  storage_path: z.string().regex(/^form-review-audio\/[^/]+\/[^/]+$/),
  mime_type: z.enum(AUDIO_MIME_TYPES),
  duration_seconds: z.number().int().min(1).max(120),
  byte_size: z.number().int().min(1).max(3 * 1024 * 1024),
})

// Strict objects so { message, audio } together is rejected.
const textOnly = z.object({ message: z.string().min(1).max(5000) }).strict()
const audioOnly = z.object({ audio: audioAttachmentSchema }).strict()

export const formReviewMessageSchema = z.union([textOnly, audioOnly])

export type FormReviewMessageInput = z.infer<typeof formReviewMessageSchema>
export type FormReviewAudioInput = z.infer<typeof audioAttachmentSchema>
