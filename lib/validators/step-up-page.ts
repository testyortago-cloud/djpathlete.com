import { z } from "zod"

/**
 * One package card in the "Packages Designed for Step Up Families" section on
 * /step-up-for-students. Order in the list is the render order. `featured`
 * highlights the card (accent border + "Most Popular" styling).
 */
export const stepUpPackageSchema = z.object({
  badge: z.string().trim().max(60),
  title: z.string().trim().min(1, "Package title is required").max(120),
  desc: z.string().trim().min(1, "Package description is required").max(600),
  items: z
    .array(z.string().trim().min(1).max(200))
    .min(1, "At least one bullet is required")
    .max(10, "No more than ten bullets per package"),
  cta: z.string().trim().min(1, "Button label is required").max(40),
  featured: z.boolean(),
})

export type StepUpPackage = z.infer<typeof stepUpPackageSchema>

/**
 * Editable copy for the Packages section on /step-up-for-students. Mirrors the
 * columns on `step_up_page_content` (00169).
 */
export const stepUpPageContentSchema = z.object({
  packages_eyebrow: z.string().trim().max(120),
  packages_heading: z.string().trim().min(1, "Heading is required").max(200),
  packages_intro: z.string().trim().min(1, "Intro is required").max(800),
  packages: z
    .array(stepUpPackageSchema)
    .min(1, "At least one package is required")
    .max(6, "No more than six packages"),
})

export type StepUpPageContent = z.infer<typeof stepUpPageContentSchema>
