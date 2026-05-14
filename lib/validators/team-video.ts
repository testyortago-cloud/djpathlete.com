import { z } from "zod"

const ALLOWED_VIDEO_MIME = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
] as const

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB

const ALLOWED_DRAWING_COLORS = [
  "#FF3B30", // red
  "#FFCC00", // yellow
  "#34C759", // green
  "#000000", // black
] as const

const drawingPathSchema = z
  .object({
    tool: z.enum(["pen", "arrow", "rectangle", "pin"]),
    color: z.enum(ALLOWED_DRAWING_COLORS),
    width: z.number().int().min(2).max(8),
    points: z
      .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
      .min(1)
      .max(500),
  })
  .superRefine((path, ctx) => {
    if (
      (path.tool === "arrow" || path.tool === "rectangle") &&
      path.points.length !== 2
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${path.tool} requires exactly 2 points, got ${path.points.length}`,
        path: ["points"],
      })
    }
    if (path.tool === "pin" && path.points.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `pin requires exactly 1 point, got ${path.points.length}`,
        path: ["points"],
      })
    }
    if (path.tool === "pen" && path.points.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `pen requires at least 2 points, got ${path.points.length}`,
        path: ["points"],
      })
    }
  })

export const drawingJsonSchema = z.object({
  paths: z.array(drawingPathSchema).min(1, "At least one path required").max(50),
})

export type DrawingJsonInput = z.infer<typeof drawingJsonSchema>

export const createSubmissionSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_VIDEO_MIME, { message: "Unsupported video format" }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_VIDEO_BYTES, "File exceeds 5GB limit"),
})

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>

export const createVersionSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_VIDEO_MIME, { message: "Unsupported video format" }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_VIDEO_BYTES, "File exceeds 5GB limit"),
})

export type CreateVersionInput = z.infer<typeof createVersionSchema>

const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB per image (IG ceiling)
const MAX_IMAGES_PER_SUBMISSION = 10

const imageSpecSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_IMAGE_MIME, { message: "Unsupported image format" }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_IMAGE_BYTES, "Image exceeds 8 MB limit"),
  position: z.number().int().min(0).max(MAX_IMAGES_PER_SUBMISSION - 1),
})

const imagesArraySchema = z
  .array(imageSpecSchema)
  .min(1, "At least one image is required")
  .max(MAX_IMAGES_PER_SUBMISSION, `At most ${MAX_IMAGES_PER_SUBMISSION} images allowed`)
  .superRefine((images, ctx) => {
    const positions = images.map((i) => i.position).sort((a, b) => a - b)
    const unique = new Set(positions)
    if (unique.size !== positions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image positions must be unique",
      })
    }
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `image positions must be contiguous starting at 0 (got ${positions.join(",")})`,
        })
        return
      }
    }
  })

export const createPhotoSubmissionSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  images: imagesArraySchema,
})

export type CreatePhotoSubmissionInput = z.infer<typeof createPhotoSubmissionSchema>

export const createPhotoVersionSchema = z.object({
  images: imagesArraySchema,
})

export type CreatePhotoVersionInput = z.infer<typeof createPhotoVersionSchema>

export const createCommentSchema = z.object({
  timecodeSeconds: z.number().min(0).nullable(),
  commentText: z.string().trim().min(1, "Comment cannot be empty").max(2000),
  annotation: drawingJsonSchema.optional(),
  /** When set, this is a reply to that parent comment id. */
  parentId: z.string().uuid().nullable().optional(),
})
  .refine(
    (d) => !d.annotation || d.timecodeSeconds != null,
    { message: "annotation requires a timecode", path: ["annotation"] },
  )
  .refine(
    (d) => !d.parentId || !d.annotation,
    {
      message: "replies cannot carry their own annotation — pin lives on the parent",
      path: ["annotation"],
    },
  )

export type CreateCommentInput = z.infer<typeof createCommentSchema>

export const statusTransitionSchema = z.object({
  action: z.enum(["request_revision", "approve", "reopen"]),
})

export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>
