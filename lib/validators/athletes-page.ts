import { z } from "zod"

/** Lucide icon picker for stage cards — keep this small + stable. */
export const STAGE_ICONS = ["plane", "graduation_cap", "sparkles", "heart_pulse"] as const
export type StageIcon = (typeof STAGE_ICONS)[number]

/**
 * One athlete-stage card on /athletes. Drives a single tile in the
 * "Four stages" grid. Stable `id` is used as both the React key and the
 * card's HTML `id` anchor for deep-linking.
 */
export const athleteStageSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "Stage id is required")
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only"),
  icon: z.enum(STAGE_ICONS),
  name: z.string().trim().min(1).max(120),
  heading: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  pillars: z
    .array(z.string().trim().min(1).max(300))
    .min(1, "At least one pillar is required")
    .max(5, "No more than five pillars per card"),
})

export type AthleteStage = z.infer<typeof athleteStageSchema>

/**
 * Editable copy on /athletes. Mirrors the columns on `athletes_page_content`
 * (00163).
 */
export const athletesPageContentSchema = z.object({
  hero_eyebrow: z.string().trim().max(120),
  hero_heading_line_1: z.string().trim().min(1).max(200),
  hero_heading_line_2: z.string().trim().min(1).max(200),
  hero_description: z.string().trim().min(1).max(800),

  stages_eyebrow: z.string().trim().max(120),
  stages_heading: z.string().trim().min(1).max(200),
  stages: z
    .array(athleteStageSchema)
    .min(1, "At least one stage card is required")
    .max(8, "No more than eight stage cards"),
})

export type AthletesPageContent = z.infer<typeof athletesPageContentSchema>
