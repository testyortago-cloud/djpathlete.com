import { z } from "zod"

export const BLOG_CATEGORIES = ["Performance", "Recovery", "Coaching", "Youth Development"] as const

// Inline image records persisted on blog_posts.inline_images (JSONB).
// Source of truth: functions/src/blog-image-generation.ts (InlineImageRecord).
// Quality/provenance fields are .optional() because pre-Task-6 records
// won't have them — admin form round-trips must not strip them on save.
export const inlineImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(180),
  prompt: z.string(),
  section_h2: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  seed: z.number().optional(),
  model: z.string().optional(),
  prompt_version: z.string().optional(),
  quality_score: z.number().optional(),
  quality_reasons: z.array(z.string()).optional(),
  judge_failed: z.boolean().optional(),
  attempts: z.number().optional(),
})

// Cover image quality/provenance metadata persisted on blog_posts.cover_image_meta (JSONB).
// Source of truth: functions/src/blog-image-generation.ts (CoverImageMeta).
// All fields .optional() for the same reason as inlineImageSchema.
export const coverImageMetaSchema = z.object({
  seed: z.number().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  prompt_version: z.string().optional(),
  quality_score: z.number().optional(),
  quality_reasons: z.array(z.string()).optional(),
  judge_failed: z.boolean().optional(),
  attempts: z.number().optional(),
})

export const faqEntrySchema = z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(800),
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
  cover_image_meta: coverImageMetaSchema.nullable().optional(),
  primary_keyword: z
    .string()
    .max(120, "Primary keyword must be under 120 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
  secondary_keywords: z
    .array(z.string().max(120))
    .max(5, "At most 5 secondary keywords")
    .optional()
    .default([]),
  search_intent: z
    .enum(["informational", "commercial", "transactional"])
    .nullable()
    .optional()
    .transform((v) => v || null),
  faq: z.array(faqEntrySchema).max(5).optional().default([]),
  subcategory: z
    .string()
    .max(80, "Subcategory must be under 80 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
  // Lets the admin form flip a post between draft/published on save (e.g.
  // "Save Draft" on an already-published post un-publishes it). Optional so
  // payloads that omit it leave status untouched.
  status: z.enum(["draft", "scheduled", "published"]).optional(),
})

export type BlogPostFormData = z.infer<typeof blogPostFormSchema>
export type InlineImage = z.infer<typeof inlineImageSchema>
export type CoverImageMeta = z.infer<typeof coverImageMetaSchema>
export type FaqEntry = z.infer<typeof faqEntrySchema>
