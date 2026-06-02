// lib/validators/split-reel.ts
import { z } from "zod"

const uuid = z.string().uuid()

export const splitReelGenerateSchema = z.object({
  videoUploadId: uuid,
})
export type SplitReelGenerateRequest = z.infer<typeof splitReelGenerateSchema>
