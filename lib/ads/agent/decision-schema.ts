// lib/ads/agent/decision-schema.ts
// Zod schema for Claude's structured output. The reasoning step validates
// every model response against this before any downstream step sees it.

import { z } from "zod"

/**
 * Strict shape for propose_new_campaign args. Applied via .superRefine
 * below — failures get reported as `args.<field>` paths and trigger the
 * one-shot retry in reasonAdsDecision. The shape matches the contract
 * documented in the system prompt; CSV export depends on every field
 * being present.
 */
export const campaignBlueprintArgsSchema = z.object({
  inventory_ref: z.string().min(1),
  inventory_kind: z.enum(["product", "event"]),
  campaign_type: z.enum(["SEARCH", "PMAX", "DISPLAY"]),
  campaign_name: z.string().min(5).max(120),
  daily_budget_cents: z.number().int().min(500).max(20_000),
  geo_targets: z.array(z.string().min(1)).min(1).max(20),
  keyword_themes: z
    .array(
      z.object({
        theme: z.string().min(1).max(60),
        match_type: z.enum(["EXACT", "PHRASE", "BROAD"]),
        keywords: z.array(z.string().min(1).max(80)).min(2).max(20),
      }),
    )
    .min(1)
    .max(5),
  negative_seed: z.array(z.string().min(1)).min(3).max(30),
  ad_copy: z.object({
    headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
    descriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
    final_url: z.string().min(1),
  }),
  conversion_goal: z.enum(["form_submission_lead", "purchase", "booking"]),
  supporting_gaql_evidence: z
    .array(
      z.object({
        gaql: z.string().min(10),
        finding: z.string().min(10).max(280),
      }),
    )
    .min(1)
    .max(5),
})

export type CampaignBlueprintArgs = z.infer<typeof campaignBlueprintArgsSchema>

export const adsAgentActionSchema = z.object({
  rank: z.number().int().min(1),
  tool: z.enum([
    "propose_budget_shift",
    "propose_new_keywords",
    "propose_negative_keywords",
    "propose_ad_copy_test",
    "propose_audience_expansion",
    "propose_new_campaign",
    "propose_campaign_pause",
    "propose_campaign_split",
    "propose_match_type_change",
    "propose_bid_strategy_review",
    "flag_for_human",
  ]),
  args: z.record(z.string(), z.unknown()),
  rationale: z.string().min(20).max(400),
  expected_metric: z.enum(["CTR", "CVR", "CAC", "ROAS", "spend_efficiency", "impression_share"]),
  expected_direction: z.enum(["increase", "decrease"]),
  confidence: z.enum(["low", "medium", "high"]),
  supporting_signals: z.array(z.string()).max(5),
})

/**
 * Validates a propose_new_campaign action's args against the strict blueprint
 * schema. Called from buildStrategistMemo AFTER the model responds, so the
 * AI SDK never sees the strict constraints (it would confuse Anthropic's
 * tool-use into emitting wrapped responses like {"$schema": ...} or
 * {"$PARAMETER_NAME": ...}). Invalid blueprints get logged and demoted to a
 * neutral status — the CSV export endpoint enforces the same schema, so a
 * malformed blueprint just can't be downloaded as a CSV.
 */
export function validateCampaignBlueprint(args: unknown):
  | { ok: true; data: CampaignBlueprintArgs }
  | { ok: false; issues: z.ZodIssue[] } {
  const parsed = campaignBlueprintArgsSchema.safeParse(args)
  if (parsed.success) return { ok: true, data: parsed.data }
  return { ok: false, issues: parsed.error.issues }
}

export const adsAgentDecisionSchema = z
  .object({
    rationale: z.string().min(1),
    actions: z.array(adsAgentActionSchema).max(7),
    watch_list: z.array(z.string()).max(5),
    brief_alignment_score: z.number().int().min(1).max(10).nullable(),
    agent_confidence: z.number().int().min(1).max(10),
    dissent_from_upstream: z.object({
      dissents: z.boolean(),
      reason: z.string().nullable(),
    }),
  })
  .refine((d) => !d.dissent_from_upstream.dissents || d.dissent_from_upstream.reason !== null, {
    message: "dissent_from_upstream.reason is required when dissents=true",
    path: ["dissent_from_upstream", "reason"],
  })

export type AdsAgentDecision = z.infer<typeof adsAgentDecisionSchema>
export type AdsAgentDecisionAction = z.infer<typeof adsAgentActionSchema>
