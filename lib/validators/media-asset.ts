import { z } from "zod"

const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i

export const mediaAssetUploadUrlSchema = z.object({
  filename: z
    .string()
    .min(1, "filename is required")
    .max(200, "filename too long")
    .refine((v) => IMAGE_EXTENSIONS.test(v), "filename must end in .jpg, .jpeg, .png, or .webp"),
  contentType: z.enum(ALLOWED_IMAGE_MIME),
})

export type MediaAssetUploadUrlPayload = z.infer<typeof mediaAssetUploadUrlSchema>

export const mediaAssetPatchSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  mime_type: z.string().min(1).optional(),
})

export type MediaAssetPatchPayload = z.infer<typeof mediaAssetPatchSchema>
