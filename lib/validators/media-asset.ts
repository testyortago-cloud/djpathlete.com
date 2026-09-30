import { z } from "zod"

const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const ALLOWED_VIDEO_MIME = ["video/mp4", "video/quicktime"] as const
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i
const VIDEO_EXTENSIONS = /\.(mp4|mov)$/i

export function isVideoMime(contentType: string): boolean {
  return (ALLOWED_VIDEO_MIME as readonly string[]).includes(contentType)
}

export const mediaAssetUploadUrlSchema = z
  .object({
    filename: z.string().min(1, "filename is required").max(200, "filename too long"),
    contentType: z.enum([...ALLOWED_IMAGE_MIME, ...ALLOWED_VIDEO_MIME]),
  })
  .refine(
    (v) => (isVideoMime(v.contentType) ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS).test(v.filename),
    {
      message: "filename must end in .jpg, .jpeg, .png, .webp, .mp4 or .mov, matching the file type",
      path: ["filename"],
    },
  )

export type MediaAssetUploadUrlPayload = z.infer<typeof mediaAssetUploadUrlSchema>

export const mediaAssetPatchSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  mime_type: z.string().min(1).optional(),
})

export type MediaAssetPatchPayload = z.infer<typeof mediaAssetPatchSchema>
