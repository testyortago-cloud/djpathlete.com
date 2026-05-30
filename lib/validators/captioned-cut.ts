import { z } from "zod"

// Permissive UUID regex that accepts all 8-4-4-4-12 hex patterns (including
// test fixtures like 11111111-1111-1111-1111-111111111111 that do not conform
// to RFC 4122 variant bits).
const uuidLike = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  )

/**
 * Create-route payload. Exactly one of videoUploadId (Content Studio drawer
 * path) or submissionId (team-review path, Milestone 2) must be present.
 */
export const captionedCutRequestSchema = z
  .object({
    videoUploadId: uuidLike.optional(),
    submissionId: uuidLike.optional(),
  })
  .refine((d) => Boolean(d.videoUploadId) !== Boolean(d.submissionId), {
    message: "Provide exactly one of videoUploadId or submissionId",
  })

export type CaptionedCutRequest = z.infer<typeof captionedCutRequestSchema>
