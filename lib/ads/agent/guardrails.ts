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
  // Brief dont_do guardrail. Approved strategy briefs may list forbidden phrases
  // (e.g. "free trial", competitor brand names). Reject any action whose
  // serialized payload mentions one (case-insensitive substring match).
  const dontDo = signals.brief_context?.dont_do ?? []
  if (dontDo.length > 0) {
    const blob = JSON.stringify(action.args ?? {}).toLowerCase()
    for (const phrase of dontDo) {
      if (blob.includes(phrase.toLowerCase())) {
        return {
          kind: "reject",
          reason: `brief_dont_do: brief.dont_do contains "${phrase}"`,
        }
      }
    }
  }

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
  // Cold-start allows two starters (one lead-gen + one purchase). Steady
  // state still caps at one — past the first active campaign, focus shifts
  // to optimising existing campaigns rather than launching new ones.
  const accountIsColdStart =
    !signals.raw ||
    signals.raw.campaigns.length === 0 ||
    signals.raw.campaigns.every((c) => c.status !== "ENABLED")
  const newCampaignCap = accountIsColdStart ? 2 : 1
  const state: BatchState = { newCampaignsProposed: 0, newDailySpendUsd: 0 }
  const results: GuardrailResult[] = []
  for (const action of actions) {
    if (action.tool === "propose_new_campaign") {
      if (state.newCampaignsProposed >= newCampaignCap) {
        results.push({
          kind: "reject",
          reason: `Already proposed ${newCampaignCap} new campaign(s) in this memo; cap is ${newCampaignCap} (${accountIsColdStart ? "cold-start" : "steady-state"}).`,
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

// ── Soft guardrails ─────────────────────────────────────────────

export type Significance = "sig" | "underpowered" | "insufficient_data"

type SignificanceInput =
  | {
      kind: "proportion"
      before: { successes: number; trials: number }
      after: { successes: number; trials: number }
    }
  | {
      kind: "mean"
      before: { sum: number; sumSq: number; n: number }
      after: { sum: number; sumSq: number; n: number }
    }

export function computeSignificance(input: SignificanceInput): Significance {
  if (input.kind === "proportion") {
    const { before, after } = input
    if (before.trials < T.SIG_MIN_SAMPLE || after.trials < T.SIG_MIN_SAMPLE) {
      return "insufficient_data"
    }
    const p1 = before.successes / before.trials
    const p2 = after.successes / after.trials
    const pooled = (before.successes + after.successes) / (before.trials + after.trials)
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / before.trials + 1 / after.trials))
    if (se === 0) return "underpowered"
    const z = Math.abs(p2 - p1) / se
    return z >= T.SIG_Z_THRESHOLD ? "sig" : "underpowered"
  }
  // Means: Welch's t-test
  const { before, after } = input
  if (before.n < T.SIG_MIN_SAMPLE || after.n < T.SIG_MIN_SAMPLE) {
    return "insufficient_data"
  }
  const m1 = before.sum / before.n
  const m2 = after.sum / after.n
  const v1 = (before.sumSq - before.sum * m1) / Math.max(1, before.n - 1)
  const v2 = (after.sumSq - after.sum * m2) / Math.max(1, after.n - 1)
  const se = Math.sqrt(v1 / before.n + v2 / after.n)
  if (se === 0) return "underpowered"
  const t = Math.abs(m2 - m1) / se
  return t >= T.SIG_Z_THRESHOLD ? "sig" : "underpowered"
}

export function computeAuditConfidence(input: {
  dataVolumeOk: boolean
  significance: Significance
  priorSimilarSucceeded: boolean
}): "low" | "medium" | "high" {
  const sigOk = input.significance === "sig"
  const score = [input.dataVolumeOk, sigOk, input.priorSimilarSucceeded].filter(Boolean).length
  if (score === 3) return "high"
  if (score === 2) return "medium"
  return "low"
}
