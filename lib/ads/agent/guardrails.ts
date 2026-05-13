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

const HARD_RULES: Array<(a: AdsAction, s: AdsSignals) => string | null> = [
  checkCampaignAge,
  checkDataVolume,
  // Additional hard rules added in later tasks
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
  for (const rule of HARD_RULES) {
    const reason = rule(action, signals)
    if (reason) return { kind: "reject", reason }
  }
  return { kind: "pass", action, annotations: defaultAnnotations() }
}
