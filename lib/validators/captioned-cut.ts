import { z } from "zod"

/**
 * Create-route payload. Exactly one of videoUploadId (Content Studio drawer
 * path) or submissionId (team-review path, Milestone 2) must be present.
 */
export const captionedCutRequestSchema = z
  .object({
    videoUploadId: z.string().uuid().optional(),
    submissionId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.videoUploadId) !== Boolean(d.submissionId), {
    message: "Provide exactly one of videoUploadId or submissionId",
  })

export type CaptionedCutRequest = z.infer<typeof captionedCutRequestSchema>
