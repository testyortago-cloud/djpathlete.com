import { z } from "zod"

const ALLOWED_VIDEO_MIME = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
] as const

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB

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

export const createCommentSchema = z.object({
  timecodeSeconds: z.number().min(0).nullable(),
  commentText: z.string().trim().min(1, "Comment cannot be empty").max(2000),
})

export type CreateCommentInput = z.infer<typeof createCommentSchema>

export const statusTransitionSchema = z.object({
  action: z.enum(["request_revision", "approve", "reopen"]),
})

export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>
