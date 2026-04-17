import { z } from "zod"

const AMAZON_HOST_REGEX = /^(?:www\.)?amazon\.[a-z.]{2,6}$/i

export const affiliateProductInputSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  description: z.string().default(""),
  thumbnail_url: z.string().url(),
  affiliate_url: z
    .string()
    .url()
    .refine((raw) => {
      try {
        const u = new URL(raw)
        return AMAZON_HOST_REGEX.test(u.hostname)
      } catch {
        return false
      }
    }, "affiliate_url must be an amazon.* URL"),
  affiliate_asin: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  affiliate_price_cents: z.number().int().positive().optional(),
})

export type AffiliateProductInput = z.infer<typeof affiliateProductInputSchema>

export const digitalProductInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
    description: z.string().default(""),
    thumbnail_url: z.string().url().optional(),
    digital_is_free: z.boolean(),
    retail_price_cents: z.number().int().positive().optional(),
    digital_access_days: z.number().int().positive().nullable().optional(),
    digital_signed_url_ttl_seconds: z
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(900),
    digital_max_downloads: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (v) => v.digital_is_free || (v.retail_price_cents && v.retail_price_cents > 0),
    { message: "retail_price_cents required for paid digital products" },
  )

export type DigitalProductInput = z.infer<typeof digitalProductInputSchema>

export const leadFormSchema = z.object({
  email: z.string().email().max(254),
  product_id: z.string().uuid(),
  // Honeypot — must be empty.
  website: z.string().max(0, "bot detected"),
})

export type LeadForm = z.infer<typeof leadFormSchema>

export const downloadSignRequestSchema = z.object({
  order_number: z.string().min(1).max(40),
  email: z.string().email(),
  download_id: z.string().uuid(),
})

export type DownloadSignRequest = z.infer<typeof downloadSignRequestSchema>
