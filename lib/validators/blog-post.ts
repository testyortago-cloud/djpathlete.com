import { z } from "zod"

export const BLOG_CATEGORIES = ["Performance", "Recovery", "Coaching", "Youth Development"] as const

export const inlineImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(180),
  prompt: z.string(),
  section_h2: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const blogPostFormSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200, "Title must be under 200 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(200, "Slug must be under 200 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase with hyphens only"),
  excerpt: z
    .string()
    .min(10, "Excerpt must be at least 10 characters")
    .max(500, "Excerpt must be under 500 characters"),
  content: z.string().min(1, "Content is required"),
  category: z.enum(BLOG_CATEGORIES, { message: "Category is required" }),
  cover_image_url: z
    .string()
    .url("Must be a valid URL")
    .nullable()
    .optional()
    .transform((v) => v || null),
  tags: z.array(z.string()).optional().default([]),
  meta_description: z
    .string()
    .max(160, "Meta description must be under 160 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
  inline_images: z.array(inlineImageSchema).optional().default([]),
})

export type BlogPostFormData = z.infer<typeof blogPostFormSchema>
export type InlineImage = z.infer<typeof inlineImageSchema>
