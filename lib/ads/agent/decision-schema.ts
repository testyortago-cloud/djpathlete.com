// lib/ads/agent/decision-schema.ts
// Zod schema for Claude's structured output. The reasoning step validates
// every model response against this before any downstream step sees it.

import { z } from "zod"

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

export const adsAgentDecisionSchema = z.object({
  rationale: z.string().min(1),
  actions: z.array(adsAgentActionSchema).max(7),
  watch_list: z.array(z.string()).max(5),
})

export type AdsAgentDecision = z.infer<typeof adsAgentDecisionSchema>
export type AdsAgentDecisionAction = z.infer<typeof adsAgentActionSchema>
