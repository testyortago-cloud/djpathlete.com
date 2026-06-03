import { z } from "zod"

/** Lucide icon picker for credential cards — keep this small + stable. */
export const CREDENTIAL_ICONS = ["graduation_cap", "award", "trophy"] as const
export type CredentialIcon = (typeof CREDENTIAL_ICONS)[number]

/** Schema.org credentialCategory we surface in the editor. */
export const CREDENTIAL_CATEGORIES = ["degree", "certification", "experience"] as const
export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number]

/**
 * A single credential as edited in the CMS. Drives BOTH the visible card on
 * /about AND a `hasCredential` entry on the Person JSON-LD — so adding a
 * credential here improves the page text and the E-E-A-T signal in one shot.
 */
export const credentialSchema = z.object({
  icon: z.enum(CREDENTIAL_ICONS),
  title: z.string().trim().min(1).max(200),
  category: z.enum(CREDENTIAL_CATEGORIES),
  recognizing_org: z.string().trim().max(200).optional(),
  recognizing_url: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\//, "Recognizing URL must start with http(s)://")
    .optional(),
})

/**
 * Authored as an explicit type (rather than inferred) so the optional fields
 * are truly `?:` instead of `string | undefined` — keeps construction sites
 * (defaults, NEW_CREDENTIAL templates) terse.
 */
export type Credential = {
  icon: CredentialIcon
  title: string
  category: CredentialCategory
  recognizing_org?: string
  recognizing_url?: string
}

/**
 * Editable copy on /about. Mirrors the columns on `about_page_content`
 * (00161 + 00162). Every field is required because the public page would
 * look broken with empty strings — empty values are stripped client-side
 * before submit, and an empty array of paragraphs is rejected here.
 */
export const aboutPageContentSchema = z.object({
  // Eyebrows are optional — when blank the small decorative label/line above
  // the heading is omitted on the page. Heading + body are still required.
  hero_eyebrow: z.string().trim().max(120),
  hero_heading: z.string().trim().min(1).max(160),
  hero_credentials_line: z.string().trim().min(1).max(300),
  hero_bio_paragraphs: z
    .array(z.string().trim().min(1).max(2000))
    .min(1, "At least one bio paragraph is required")
    .max(6, "No more than six bio paragraphs"),

  aeo_eyebrow: z.string().trim().max(60),
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

  cta_eyebrow: z.string().trim().max(120),
  cta_heading: z.string().trim().min(1).max(160),
  cta_description: z.string().trim().min(1).max(500),
  cta_button_label: z.string().trim().min(1).max(60),
  cta_button_href: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^(\/|https?:\/\/)/, "Link must start with / or http(s)://"),

  // ─── SEO / E-E-A-T ────────────────────────────────────────────────
  meta_title: z.string().trim().min(1).max(70, "Keep meta titles under 70 characters"),
  meta_description: z
    .string()
    .trim()
    .min(1)
    .max(180, "Keep meta descriptions under 180 characters"),
  credentials: z
    .array(credentialSchema)
    .min(1, "At least one credential is required")
    .max(20, "No more than twenty credentials"),
})

export type AboutPageContent = z.infer<typeof aboutPageContentSchema>
