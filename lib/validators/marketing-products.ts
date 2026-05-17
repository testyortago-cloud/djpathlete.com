// lib/validators/marketing-products.ts
// Zod schemas for marketing_products CRUD. Mirrors the table schema in
// migration 00154 plus the DB-side CHECK constraints. Used by both the
// API routes (server-side) and the admin form (resolver).

import { z } from "zod"

export const marketingProductInputSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits, and underscores only"),
  name: z.string().min(2).max(120),
  one_liner: z.string().min(20).max(400),
  target_audience: z.string().min(10).max(600),
  signature_phrases: z.array(z.string().min(1).max(80)).min(1).max(20),
  pain_points: z.array(z.string().min(1).max(120)).max(20).default([]),
  landing_url: z.string().min(1).max(400),
  lead_form_url: z.string().min(1).max(400).nullable(),
  price_cents: z.number().int().min(0).nullable(),
  regular_price_cents: z.number().int().min(0).nullable(),
  geo_focus: z.array(z.string().min(1).max(60)).min(1).max(30),
  conversion_type: z.enum(["purchase", "lead", "booking"]),
  status: z.enum(["active", "draft", "archived"]),
  notes: z.string().max(2000).nullable(),
})

export type MarketingProductInputParsed = z.infer<typeof marketingProductInputSchema>

export const marketingProductPatchSchema = marketingProductInputSchema.partial()
