// lib/ads/agent/guardrails.ts
// Pure-function gate between the model's output and persisted actions.
// Returns either { kind: "pass", action, annotations } or { kind: "reject", reason }.

import * as T from "./thresholds"
import type {
  AdsAction,
  AdsSignals,
  GuardrailResult,
  GuardrailAnnotations,
} from "./types"

function findCampaign(signals: AdsSignals, id: string | undefined) {
  if (!id || !signals.raw) return null
  return signals.raw.campaigns.find((c) => c.id === id) ?? null
}

function actionCampaignId(action: AdsAction): string | undefined {
  const args = action.args as Record<string, unknown>
  return (args.campaign_id as string | undefined) ?? (args.from_campaign_id as string | undefined)
}

function checkCampaignAge(action: AdsAction, signals: AdsSignals): string | null {
  // Skip age check for new-campaign proposals (no existing campaign to check).
  if (action.tool === "propose_new_campaign" || action.tool === "flag_for_human") return null
  const campaignId = actionCampaignId(action)
  const campaign = findCampaign(signals, campaignId)
  if (!campaign) return null
  const ageDays = (Date.now() - new Date(campaign.created_at).getTime()) / 86_400_000
  if (ageDays < T.CAMPAIGN_MIN_AGE_DAYS) {
    return `Campaign ${campaign.id} is ${ageDays.toFixed(1)} days old; below ${T.CAMPAIGN_MIN_AGE_DAYS}-day Smart Bidding learning period.`
  }
  return null
}

function checkDataVolume(action: AdsAction, signals: AdsSignals): string | null {
  if (action.tool === "propose_new_campaign" || action.tool === "flag_for_human") return null
  const campaign = findCampaign(signals, actionCampaignId(action))
  if (!campaign) return null
  const { clicks, conversions } = campaign.metrics_28d
  if (clicks < T.MIN_CLICKS_FOR_RECOMMENDATION) {
    return `Insufficient clicks: ${clicks} < ${T.MIN_CLICKS_FOR_RECOMMENDATION} in 28d on campaign ${campaign.id}.`
  }
  if (conversions < T.MIN_CONVERSIONS_FOR_RECOMMENDATION) {
    return `Insufficient conversions: ${conversions} < ${T.MIN_CONVERSIONS_FOR_RECOMMENDATION} in 28d on campaign ${campaign.id}.`
  }
  return null
}

function clampBudgetShift(action: AdsAction): { action: AdsAction; clamped: boolean } {
  if (action.tool !== "propose_budget_shift") return { action, clamped: false }
  const args = { ...action.args } as Record<string, unknown>
  const raw = args.delta_pct
  if (typeof raw !== "number") return { action, clamped: false }
  const max = T.MAX_BUDGET_SHIFT_PCT
  const clampedVal = Math.max(-max, Math.min(max, raw))
  args.delta_pct = clampedVal
  return { action: { ...action, args }, clamped: clampedVal !== raw }
}

function checkPauseProtection(action: AdsAction, signals: AdsSignals): string | null {
  if (action.tool !== "propose_campaign_pause") return null
  const campaign = findCampaign(signals, actionCampaignId(action))
  if (!campaign) return null
  const conv7d = campaign.last_7d_conversions ?? 0
  if (conv7d >= T.PAUSE_PROTECTION_MIN_CONVERSIONS) {
    return `Campaign ${campaign.id} drove ${conv7d} conversion(s) in last 7 days — pause-protected.`
  }
  return null
}

function checkBrandAllowlist(action: AdsAction): string | null {
  if (action.tool !== "propose_negative_keywords") return null
  const args = action.args as { negatives?: Array<{ text: string }> }
  const negatives = args.negatives ?? []
  for (const n of negatives) {
    const txt = n.text.toLowerCase()
    if (T.BRAND_TERM_ALLOWLIST.some((brand) => txt.includes(brand.toLowerCase()))) {
      return `Negative keyword "${n.text}" overlaps protected brand term.`
    }
  }
  return null
}

const MATCH_TYPE_RANK: Record<string, number> = { broad: 3, phrase: 2, exact: 1 }

function checkMatchTypeDirection(action: AdsAction): string | null {
  if (action.tool !== "propose_match_type_change") return null
  const args = action.args as { from_match_type?: string; to_match_type?: string }
  const from = args.from_match_type ?? ""
  const to = args.to_match_type ?? ""
  const fromRank = MATCH_TYPE_RANK[from]
  const toRank = MATCH_TYPE_RANK[to]
  if (fromRank == null || toRank == null) return `Unknown match type: ${from} → ${to}.`
  if (toRank > fromRank) {
    return `Match-type loosening (${from} → ${to}) not allowed in v1; tightening only.`
  }
  return null
}

function checkNewCampaignBudget(action: AdsAction): string | null {
  if (action.tool !== "propose_new_campaign") return null
  const args = action.args as { initial_daily_budget?: number }
  const budget = args.initial_daily_budget ?? 0
  if (budget > T.NEW_CAMPAIGN_MAX_DAILY_BUDGET) {
    return `New campaign $${budget} exceeds max new-campaign daily budget $${T.NEW_CAMPAIGN_MAX_DAILY_BUDGET}.`
  }
  return null
}

interface BatchState {
  newCampaignsProposed: number
  newDailySpendUsd: number
}

function newDailySpendFromAction(action: AdsAction, signals: AdsSignals): number {
  if (action.tool === "propose_new_campaign") {
    const args = action.args as { initial_daily_budget?: number }
    return args.initial_daily_budget ?? 0
  }
  if (action.tool === "propose_budget_shift") {
    const args = action.args as { from_campaign_id?: string; to_campaign_id?: string; delta_pct?: number }
    if (args.from_campaign_id === args.to_campaign_id) {
      const campaign = findCampaign(signals, args.to_campaign_id)
      if (!campaign) return 0
      const delta = (args.delta_pct ?? 0) / 100
      return Math.max(0, campaign.daily_budget_usd * delta)
    }
    return 0
  }
  return 0
}

const HARD_RULES: Array<(a: AdsAction, s: AdsSignals) => string | null> = [
  checkCampaignAge,
  checkDataVolume,
  checkPauseProtection,
  checkBrandAllowlist,
  checkMatchTypeDirection,
  checkNewCampaignBudget,
]

function defaultAnnotations(): GuardrailAnnotations {
  return {
    significance: "insufficient_data",
    audit_confidence: "low",
    seasonality_flag: false,
    clamped: false,
  }
}

export function applyGuardrails(action: AdsAction, signals: AdsSignals): GuardrailResult {
  const { action: clampedAction, clamped } = clampBudgetShift(action)
  for (const rule of HARD_RULES) {
    const reason = rule(clampedAction, signals)
    if (reason) return { kind: "reject", reason }
  }
  return {
    kind: "pass",
    action: clampedAction,
    annotations: { ...defaultAnnotations(), clamped },
  }
}

export function applyGuardrailsBatch(
  actions: AdsAction[],
  signals: AdsSignals,
): GuardrailResult[] {
  const state: BatchState = { newCampaignsProposed: 0, newDailySpendUsd: 0 }
  const results: GuardrailResult[] = []
  for (const action of actions) {
    if (action.tool === "propose_new_campaign") {
      if (state.newCampaignsProposed >= 1) {
        results.push({
          kind: "reject",
          reason: `Already proposed 1 new campaign in this memo; cap is 1.`,
        })
        continue
      }
    }
    const incremental = newDailySpendFromAction(action, signals)
    if (state.newDailySpendUsd + incremental > T.MAX_NEW_DAILY_SPEND_PER_MEMO) {
      results.push({
        kind: "reject",
        reason: `Total new daily spend cap exceeded: $${(state.newDailySpendUsd + incremental).toFixed(2)} > $${T.MAX_NEW_DAILY_SPEND_PER_MEMO}.`,
      })
      continue
    }

    const single = applyGuardrails(action, signals)
    results.push(single)
    if (single.kind === "pass") {
      if (action.tool === "propose_new_campaign") state.newCampaignsProposed += 1
      state.newDailySpendUsd += incremental
    }
  }
  return results
}
