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
