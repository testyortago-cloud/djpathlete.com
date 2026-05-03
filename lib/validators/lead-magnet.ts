import { z } from "zod"
import { BLOG_CATEGORIES } from "./blog-post"

export const leadMagnetFormSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase with hyphens only"),
  title: z.string().min(3).max(140),
  description: z.string().min(10).max(400),
  asset_url: z.string().url("Must be a valid URL"),
  category: z.enum(BLOG_CATEGORIES).nullable().optional().transform((v) => v || null),
  tags: z.array(z.string().min(1).max(60)).max(10).optional().default([]),
  active: z.boolean().optional().default(true),
})

export type LeadMagnetFormData = z.infer<typeof leadMagnetFormSchema>
