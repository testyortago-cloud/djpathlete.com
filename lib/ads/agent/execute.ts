// lib/ads/agent/execute.ts
// Per-tool handlers for the full 11-tool ads-agent catalog. Every accepted
// action becomes a row in google_ads_recommendations with status='pending'.
// Human approval via the existing recommendations queue is required before
// changes propagate to Google Ads.
//
// Schema reality check (post-migration 00131)
// -------------------------------------------
// The CHECK constraint now accepts all 14 recommendation_type values:
//   add_negative_keyword | adjust_bid | pause_keyword | add_keyword
//   | add_ad_variant | pause_ad             (existing — manual UI + sync)
//   | budget_shift | audience_expansion | new_campaign | campaign_pause
//   | campaign_split | match_type_change | bid_strategy_review | flag
//                                          (added for the ads agent)
//
// scope_type accepts 5 values:
//   campaign | ad_group | keyword | ad | account
//   ('account' is for actions not bound to an existing entity, i.e.
//    new_campaign and flag_for_human.)
//
// memo_id (uuid) and source (text) are now top-level columns; we set them
// directly instead of stuffing them inside `payload`.

import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsRecommendationScope,
  GoogleAdsRecommendationType,
} from "@/types/database"
import type {
  AdsAction,
  AdsActionTool,
  GuardrailResult,
  GoogleAdsAgentMemoAction,
  GoogleAdsAgentMemoGuardrailRejection,
} from "./types"

export interface ExecuteAdsActionOptions {
  memo_id: string
  customer_id: string
}

export interface ExecuteAdsActionResult {
  recommendation_id: string
}

interface ToolMapping {
  recommendation_type: GoogleAdsRecommendationType
  resolveScope: (
    args: Record<string, unknown>,
    tool: AdsActionTool,
  ) => {
    scope_type: GoogleAdsRecommendationScope
    scope_id: string
  }
}

/**
 * Sentinel scope_ids for actions that aren't bound to an existing entity.
 * They satisfy the NOT NULL constraint while signalling "no real entity" to
 * downstream apply / UI code.
 */
const SCOPE_ID_NEW_CAMPAIGN = "__new_campaign__"
const SCOPE_ID_ACCOUNT = "__account__"

/**
 * Reads a string field off `args` and throws a clear, tool-named error if it
 * is missing or empty. The thrown message intentionally mentions the field
 * name so callers can see which arg the tool forgot.
 */
function requireArg(
  args: Record<string, unknown>,
  field: string,
  tool: AdsActionTool,
): string {
  const value = args[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${tool} requires args.${field}`)
  }
  return value
}

const TOOL_MAPPINGS: Record<AdsActionTool, ToolMapping> = {
  propose_new_keywords: {
    recommendation_type: "add_keyword",
    resolveScope: (args, tool) => ({
      scope_type: "ad_group",
      scope_id: requireArg(args, "ad_group_id", tool),
    }),
  },
  propose_negative_keywords: {
    recommendation_type: "add_negative_keyword",
    resolveScope: (args, tool) => ({
      scope_type: "campaign",
      scope_id: requireArg(args, "campaign_id", tool),
    }),
  },
  propose_ad_copy_test: {
    recommendation_type: "add_ad_variant",
    resolveScope: (args, tool) => ({
      scope_type: "ad_group",
      scope_id: requireArg(args, "ad_group_id", tool),
    }),
  },
  propose_budget_shift: {
    recommendation_type: "budget_shift",
    // Pin to the *destination* campaign — that's where the increased spend
    // lands and where the impact will be observed.
    resolveScope: (args, tool) => ({
      scope_type: "campaign",
      scope_id: requireArg(args, "to_campaign_id", tool),
    }),
  },
  propose_audience_expansion: {
    recommendation_type: "audience_expansion",
    resolveScope: (args, tool) => ({
      scope_type: "campaign",
      scope_id: requireArg(args, "campaign_id", tool),
    }),
  },
  propose_new_campaign: {
    recommendation_type: "new_campaign",
    // No existing entity yet — scope to the account with a sentinel id.
    resolveScope: () => ({
      scope_type: "account",
      scope_id: SCOPE_ID_NEW_CAMPAIGN,
    }),
  },
  propose_campaign_pause: {
    recommendation_type: "campaign_pause",
    resolveScope: (args, tool) => ({
      scope_type: "campaign",
      scope_id: requireArg(args, "campaign_id", tool),
    }),
  },
  propose_campaign_split: {
    recommendation_type: "campaign_split",
    resolveScope: (args, tool) => ({
      scope_type: "campaign",
      scope_id: requireArg(args, "campaign_id", tool),
    }),
  },
  propose_match_type_change: {
    recommendation_type: "match_type_change",
    resolveScope: (args, tool) => ({
      scope_type: "keyword",
      scope_id: requireArg(args, "keyword_id", tool),
    }),
  },
  propose_bid_strategy_review: {
    recommendation_type: "bid_strategy_review",
    resolveScope: (args, tool) => ({
      scope_type: "campaign",
      scope_id: requireArg(args, "campaign_id", tool),
    }),
  },
  flag_for_human: {
    recommendation_type: "flag",
    // Account-level signal — no required args.
    resolveScope: () => ({
      scope_type: "account",
      scope_id: SCOPE_ID_ACCOUNT,
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
    // AdsActionTool is a closed union, so this branch is unreachable at the
    // type level; we keep it as a runtime safety net in case the union grows.
    throw new Error(`executeAdsAction: unknown tool '${action.tool}'`)
  }

  const { scope_type, scope_id } = mapping.resolveScope(action.args, action.tool)

  const row = {
    customer_id: opts.customer_id,
    scope_type,
    scope_id,
    recommendation_type: mapping.recommendation_type,
    memo_id: opts.memo_id,
    source: "ads_agent",
    payload: {
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

// ─────────────────────────────────────────────────────────────────
// Batch wrapper — runs each (guardrail, originalAction) pair through
// executeAdsAction, building the memo's `actions` + `guardrail_rejections`
// arrays. Rejections never touch the recommendations table. Throws
// from executeAdsAction become `status: "failed"` rows on the memo
// (not rejections — rejections are guardrail-decided only).
// Each pair is processed independently; a single failure never blocks
// the rest of the batch.
// ─────────────────────────────────────────────────────────────────

export interface PreExecutionPair {
  guardrail: GuardrailResult
  originalAction: AdsAction
}

export interface ExecuteAdsActionsResult {
  actions: GoogleAdsAgentMemoAction[]
  rejections: GoogleAdsAgentMemoGuardrailRejection[]
}

export async function executeAdsActions(
  pairs: PreExecutionPair[],
  ctx: { memo_id: string; customer_id: string },
): Promise<ExecuteAdsActionsResult> {
  const actions: GoogleAdsAgentMemoAction[] = []
  const rejections: GoogleAdsAgentMemoGuardrailRejection[] = []

  for (const { guardrail, originalAction } of pairs) {
    if (guardrail.kind === "reject") {
      rejections.push({
        rank: originalAction.rank,
        tool: originalAction.tool,
        reason: guardrail.reason,
      })
      actions.push({
        rank: originalAction.rank,
        tool: originalAction.tool,
        args: originalAction.args,
        rationale: originalAction.rationale,
        expected_metric: originalAction.expected_metric,
        expected_direction: originalAction.expected_direction,
        confidence: originalAction.confidence,
        audit_confidence: "low",
        significance: "insufficient_data",
        supporting_signals: originalAction.supporting_signals,
        status: "rejected_by_guardrails",
        recommendation_id: null,
        applied_at: null,
        clamped: false,
      })
      continue
    }
    try {
      const { recommendation_id } = await executeAdsAction(guardrail.action, ctx)
      actions.push({
        rank: guardrail.action.rank,
        tool: guardrail.action.tool,
        args: guardrail.action.args,
        rationale: guardrail.action.rationale,
        expected_metric: guardrail.action.expected_metric,
        expected_direction: guardrail.action.expected_direction,
        confidence: guardrail.action.confidence,
        audit_confidence: guardrail.annotations.audit_confidence,
        significance: guardrail.annotations.significance,
        supporting_signals: guardrail.action.supporting_signals,
        status: "queued",
        recommendation_id,
        applied_at: null,
        clamped: guardrail.annotations.clamped,
      })
    } catch (err) {
      // This used to be a bare `catch {}`. An action that threw here became a
      // status:"failed" row with NO reason recorded anywhere — it simply never
      // showed up in the queue and nothing said why. That hid a structurally
      // dead tool (propose_ad_copy_test demands args.ad_group_id, which the
      // agent cannot supply because its raw inputs contain no ad groups) for
      // as long as the agent has existed.
      const failure_reason = err instanceof Error ? err.message : String(err)
      console.error(
        `[ads-agent] action rank=${guardrail.action.rank} tool=${guardrail.action.tool} failed to execute: ${failure_reason}`,
      )
      actions.push({
        rank: guardrail.action.rank,
        tool: guardrail.action.tool,
        args: guardrail.action.args,
        rationale: guardrail.action.rationale,
        expected_metric: guardrail.action.expected_metric,
        expected_direction: guardrail.action.expected_direction,
        confidence: guardrail.action.confidence,
        audit_confidence: guardrail.annotations.audit_confidence,
        significance: guardrail.annotations.significance,
        supporting_signals: guardrail.action.supporting_signals,
        status: "failed",
        recommendation_id: null,
        applied_at: null,
        clamped: guardrail.annotations.clamped,
        failure_reason,
      })
    }
  }
  return { actions, rejections }
}
