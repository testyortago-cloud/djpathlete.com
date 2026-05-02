import { z } from "zod"

// Tracking params accepted in incoming requests.
// All optional; we ignore unknown extras.
export const trackingParamsSchema = z.object({
  gclid:        z.string().max(200).optional(),
  gbraid:       z.string().max(200).optional(),
  wbraid:       z.string().max(200).optional(),
  fbclid:       z.string().max(200).optional(),
  utm_source:   z.string().max(200).optional(),
  utm_medium:   z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term:     z.string().max(200).optional(),
  utm_content:  z.string().max(200).optional(),
  landing_url:  z.string().url().max(2000).optional(),
  referrer:     z.string().max(2000).optional(),
})

export type TrackingParams = z.infer<typeof trackingParamsSchema>

// Body schema for /api/public/attribution/track
export const attributionTrackBodySchema = z.object({
  session_id: z.string().min(8).max(128),
}).extend(trackingParamsSchema.shape)

export const marketingConsentToggleBodySchema = z.object({
  granted: z.boolean(),
  source:  z.string().max(80).optional(),
})

export const TRACKING_PARAM_KEYS = [
  "gclid", "gbraid", "wbraid", "fbclid",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
] as const
export type TrackingParamKey = typeof TRACKING_PARAM_KEYS[number]
