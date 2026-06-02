import { z } from "zod"

/**
 * Editable copy on /about. Mirrors the columns on `about_page_content`
 * (00161). Every field is required because the public page would look
 * broken with empty strings — empty values are stripped client-side
 * before submit, and an empty array of paragraphs is rejected here.
 */
export const aboutPageContentSchema = z.object({
  hero_eyebrow: z.string().trim().min(1).max(120),
  hero_heading: z.string().trim().min(1).max(160),
  hero_credentials_line: z.string().trim().min(1).max(300),
  hero_bio_paragraphs: z
    .array(z.string().trim().min(1).max(2000))
    .min(1, "At least one bio paragraph is required")
    .max(6, "No more than six bio paragraphs"),

  aeo_eyebrow: z.string().trim().min(1).max(60),
  aeo_question: z.string().trim().min(1).max(300),
  aeo_answer: z
    .string()
    .trim()
    .min(1, "AEO answer is required")
    .max(4000, "Keep the AEO answer under 4000 characters"),

  story_heading: z.string().trim().min(1).max(120),
  story_paragraphs: z
    .array(z.string().trim().min(1).max(2000))
    .min(1, "At least one story paragraph is required")
    .max(10, "No more than ten story paragraphs"),

  cta_eyebrow: z.string().trim().min(1).max(120),
  cta_heading: z.string().trim().min(1).max(160),
  cta_description: z.string().trim().min(1).max(500),
  cta_button_label: z.string().trim().min(1).max(60),
  cta_button_href: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^(\/|https?:\/\/)/, "Link must start with / or http(s)://"),
})

export type AboutPageContent = z.infer<typeof aboutPageContentSchema>
