import { z } from "zod"

export const googleAdsCampaignTypeSchema = z.enum([
  "SEARCH",
  "VIDEO",
  "PERFORMANCE_MAX",
  "DISPLAY",
  "SHOPPING",
  "DEMAND_GEN",
  "LOCAL_SERVICES",
  "APP",
  "HOTEL",
  "SMART",
  "UNKNOWN",
])

export const googleAdsResourceStatusSchema = z.enum(["ENABLED", "PAUSED", "REMOVED"])
export const googleAdsKeywordMatchTypeSchema = z.enum(["EXACT", "PHRASE", "BROAD"])
export const googleAdsAutomationModeSchema = z.enum(["auto_pilot", "co_pilot", "advisory"])

export const oauthCallbackQuerySchema = z
  .object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .refine((v) => Boolean(v.code) || Boolean(v.error), {
    message: "callback must include code or error",
  })

export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>

// ─── Phase 1.2: AI recommendations ────────────────────────────────────────────

export const recommendationTypeSchema = z.enum([
  "add_negative_keyword",
  "adjust_bid",
  "pause_keyword",
  "add_keyword",
  "add_ad_variant",
  "pause_ad",
])

export const recommendationScopeSchema = z.enum(["campaign", "ad_group", "keyword", "ad"])

export const recommendationStatusSchema = z.enum([
  "pending",
  "approved",
  "applied",
  "rejected",
  "auto_applied",
  "failed",
  "expired",
])

/**
 * Per-recommendation payload schemas. Each variant captures exactly what the
 * apply path (Plan 1.3) needs to construct the Google Ads mutation.
 */
export const negativeKeywordPayloadSchema = z.object({
  text: z.string().min(1).max(80),
  match_type: googleAdsKeywordMatchTypeSchema,
})

export const bidAdjustmentPayloadSchema = z.object({
  current_micros: z.number().int().nonnegative(),
  proposed_micros: z.number().int().nonnegative(),
})

export const keywordRefPayloadSchema = z.object({
  criterion_id: z.string().min(1),
})

export const newKeywordPayloadSchema = z.object({
  text: z.string().min(1).max(80),
  match_type: googleAdsKeywordMatchTypeSchema,
  initial_cpc_bid_micros: z.number().int().nonnegative().optional(),
})

export const adVariantPayloadSchema = z.object({
  headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
  descriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
  final_url: z.string().url(),
})

/**
 * The AI-generated structured output schema. recommendation_type drives the
 * payload shape, but Zod's discriminated union would force per-type prompting;
 * we keep it loose (record<unknown>) at generation time and re-validate the
 * payload narrowly when the apply path consumes it.
 */
export const recommendationItemSchema = z.object({
  recommendation_type: recommendationTypeSchema,
  scope_type: recommendationScopeSchema,
  scope_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  reasoning: z.string().min(20).max(500),
  confidence: z.number().min(0).max(1),
})

export const recommendationBatchSchema = z.object({
  recommendations: z.array(recommendationItemSchema).max(20),
})

export type RecommendationItem = z.infer<typeof recommendationItemSchema>
export type RecommendationBatch = z.infer<typeof recommendationBatchSchema>
