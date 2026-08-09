import { z } from "zod"

const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase with hyphens only")

/** Slugs that would collide with an existing top-level route or a reserved path. */
const RESERVED_FUNNEL_SLUGS = new Set(["admin", "api", "client", "go", "login", "register"])

export const createFunnelSchema = z.object({
  slug: slugSchema.refine((s) => !RESERVED_FUNNEL_SLUGS.has(s), "That slug is reserved"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
})

export const updateFunnelSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
})

export const createStepSchema = z.object({
  funnel_id: z.string().uuid(),
  slug: slugSchema,
  name: z.string().min(2).max(120),
})

export const updateStepSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(2).max(120).optional(),
  position: z.number().int().min(0).max(200).optional(),
  seo_title: z.string().max(160).nullable().optional(),
  seo_description: z.string().max(320).nullable().optional(),
  og_image_url: z.string().url().nullable().optional(),
  noindex: z.boolean().optional(),
  /** GrapesJS editor state. Opaque to us — only the compiler reads its output. */
  project_data: z.unknown().optional(),
})

export const publishStepSchema = z.object({
  html: z.string().max(500_000),
  css: z.string().max(200_000),
  project_data: z.unknown().optional(),
})

export type CreateFunnelData = z.infer<typeof createFunnelSchema>
export type UpdateFunnelData = z.infer<typeof updateFunnelSchema>
export type UpdateStepData = z.infer<typeof updateStepSchema>
export type PublishStepData = z.infer<typeof publishStepSchema>
