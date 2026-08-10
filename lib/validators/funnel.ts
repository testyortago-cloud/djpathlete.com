import { z } from "zod"
import { SECTION_BUILDER_MAX_MESSAGE_LENGTH } from "@/lib/funnels/sections/builder-config"

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
  /**
   * The DRAFT `SectionDoc` (`lib/funnels/sections/registry.ts`). Was GrapesJS
   * editor state before 00203. Deliberately still `z.unknown()` here rather
   * than `sectionDocSchema`: this schema also serves steps that have never
   * been through the AI builder and still hold legacy GrapesJS state, and the
   * builder's own write path (`lib/db/funnel-builder.ts`) validates the doc
   * with the registry schema before it ever reaches the column.
   */
  project_data: z.unknown().optional(),
})

/**
 * Body of `POST /api/admin/funnels/steps/[id]/build` — one owner message plus
 * the revision the client believes is current.
 *
 * `revision` IS REQUIRED AND IS THE OPTIMISTIC LOCK. Two admin tabs on the
 * same page is a real scenario; without it the second tab's build silently
 * overwrites the first tab's document. `appendTurn` makes the check part of
 * the write (`.eq("doc_revision", expectedRevision)`), and the route turns a
 * `stale_revision` result into a 409 so the client re-syncs rather than
 * clobbering. A schema that made this optional would let a client opt out of
 * the lock by omission, which is the same bug wearing a default value.
 *
 * The length cap is IMPORTED from `builder-config.ts`, never restated: that
 * file is the single place the builder's tunables live, and a bound copied to
 * two places is a bound that drifts. Restating it as `12_000` here would let
 * someone raise the config constant and still be rejected at the door with no
 * indication why.
 */
export const buildRequestSchema = z.object({
  message: z.string().trim().min(1).max(SECTION_BUILDER_MAX_MESSAGE_LENGTH),
  revision: z.number().int().min(0),
})

/**
 * Publish-time size caps. Named and exported — not restated as bare literals
 * anywhere else — so `lib/funnels/sections/doc.ts` (which enforces the same
 * ceiling at DRAFT time, before publish, so an oversized page is caught
 * while the owner is still iterating) can never drift from the number this
 * schema actually enforces.
 */
export const FUNNEL_STEP_HTML_MAX_LENGTH = 500_000
export const FUNNEL_STEP_CSS_MAX_LENGTH = 200_000

export const publishStepSchema = z.object({
  html: z.string().max(FUNNEL_STEP_HTML_MAX_LENGTH),
  css: z.string().max(FUNNEL_STEP_CSS_MAX_LENGTH),
  project_data: z.unknown().optional(),
})

export type CreateFunnelData = z.infer<typeof createFunnelSchema>
export type UpdateFunnelData = z.infer<typeof updateFunnelSchema>
export type UpdateStepData = z.infer<typeof updateStepSchema>
export type PublishStepData = z.infer<typeof publishStepSchema>
export type BuildRequestData = z.infer<typeof buildRequestSchema>
