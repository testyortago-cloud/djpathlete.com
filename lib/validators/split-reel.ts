// lib/validators/split-reel.ts
import { z } from "zod"

const uuid = z.string().uuid()

export const splitReelGenerateSchema = z.object({
  videoUploadId: uuid,
})
export type SplitReelGenerateRequest = z.infer<typeof splitReelGenerateSchema>

// Phase 3: manual render gate.
export const splitReelRenderSchema = z.object({
  videoUploadId: uuid,
})
export type SplitReelRenderRequest = z.infer<typeof splitReelRenderSchema>

// Phase 3: regenerate one b-roll window (optionally with an edited prompt).
export const brollRegenerateSchema = z.object({
  segmentId: uuid,
  prompt: z.string().min(1).max(800).optional(),
})
export type BrollRegenerateRequest = z.infer<typeof brollRegenerateSchema>
