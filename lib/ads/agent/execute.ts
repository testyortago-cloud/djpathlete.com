// lib/ads/agent/execute.ts
// Per-tool handlers for within-campaign actions. Every accepted action becomes
// a row in google_ads_recommendations with status='pending' and the agent's
// memo back-reference stored inside `payload` (the table has no top-level
// memo_id / source columns — see migration 00116). Human approval via the
// existing recommendations queue is required before changes propagate to
// Google Ads.
//
// IMPORTANT — schema reality check
// The existing google_ads_recommendations CHECK constraint accepts only:
//   add_negative_keyword | adjust_bid | pause_keyword | add_keyword
//   | add_ad_variant | pause_ad
// Three of the agent's within-campaign tools map cleanly:
//   propose_new_keywords        -> add_keyword
//   propose_negative_keywords   -> add_negative_keyword
//   propose_ad_copy_test        -> add_ad_variant
// The remaining tools (budget_shift, audience_expansion, the cross-campaign
// proposals, flag_for_human) have no slot in the current CHECK. They throw a
// typed error so callers can route them to a follow-up sink (or to a future
// schema migration that extends recommendation_type).

import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsRecommendationScope } from "@/types/database"
import type { AdsAction, AdsActionTool } from "./types"

export interface ExecuteAdsActionOptions {
  memo_id: string
  customer_id: string
}

export interface ExecuteAdsActionResult {
  recommendation_id: string
}

interface ToolMapping {
  recommendation_type:
    | "add_negative_keyword"
    | "adjust_bid"
    | "pause_keyword"
    | "add_keyword"
    | "add_ad_variant"
    | "pause_ad"
  resolveScope: (args: Record<string, unknown>) => {
    scope_type: GoogleAdsRecommendationScope
    scope_id: string
  }
}

const TOOL_MAPPINGS: Partial<Record<AdsActionTool, ToolMapping>> = {
  propose_new_keywords: {
    recommendation_type: "add_keyword",
    resolveScope: (args) => ({
      scope_type: "ad_group",
      scope_id: String(args.ad_group_id ?? args.campaign_id ?? ""),
    }),
  },
  propose_negative_keywords: {
    recommendation_type: "add_negative_keyword",
    resolveScope: (args) => ({
      scope_type: "campaign",
      scope_id: String(args.campaign_id ?? ""),
    }),
  },
  propose_ad_copy_test: {
    recommendation_type: "add_ad_variant",
    resolveScope: (args) => ({
      scope_type: "ad_group",
      scope_id: String(args.ad_group_id ?? ""),
    }),
  },
}

const CONFIDENCE_TO_NUMERIC: Record<AdsAction["confidence"], number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.85,
}

export async function executeAdsAction(
  action: AdsAction,
  opts: ExecuteAdsActionOptions,
): Promise<ExecuteAdsActionResult> {
  const mapping = TOOL_MAPPINGS[action.tool]
  if (!mapping) {
    throw new Error(
      `executeAdsAction: no recommendation_type mapping for tool '${action.tool}'. ` +
        `The google_ads_recommendations CHECK constraint only accepts ` +
        `add_negative_keyword | adjust_bid | pause_keyword | add_keyword | ` +
        `add_ad_variant | pause_ad. Extend the constraint via a follow-up ` +
        `migration before routing this tool through the recommendations queue.`,
    )
  }

  const { scope_type, scope_id } = mapping.resolveScope(action.args)
  if (!scope_id) {
    throw new Error(
      `executeAdsAction: tool '${action.tool}' produced an empty scope_id from ` +
        `args; cannot satisfy google_ads_recommendations.scope_id NOT NULL.`,
    )
  }

  const row = {
    customer_id: opts.customer_id,
    scope_type,
    scope_id,
    recommendation_type: mapping.recommendation_type,
    payload: {
      // memo back-reference + provenance live in payload because the table
      // has no top-level memo_id or source columns.
      memo_id: opts.memo_id,
      source: "ads_agent",
      tool: action.tool,
      args: action.args,
      expected_metric: action.expected_metric,
      expected_direction: action.expected_direction,
      confidence: action.confidence,
      supporting_signals: action.supporting_signals,
      rank: action.rank,
    },
    reasoning: action.rationale,
    confidence: CONFIDENCE_TO_NUMERIC[action.confidence],
    status: "pending" as const,
  }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("google_ads_recommendations")
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return { recommendation_id: (data as { id: string }).id }
}
