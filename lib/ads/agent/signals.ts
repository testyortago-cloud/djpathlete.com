// lib/ads/agent/signals.ts
// Gathers the unified snapshot the reasoning step consumes:
// 0. Preflight (data-quality gate)
// 1. Raw inputs (added in Task 10)
// 2. Derived cross-channel signals (added in Task 11)
// 3. Learning layer (added in Task 11)

import type { SupabaseClient } from "@supabase/supabase-js"
import * as T from "./thresholds"
import { listChannelBaselines } from "@/lib/db/agent-tool-baselines"
import { readFewShots } from "@/lib/agents/few-shots"
import type { BriefContext } from "@/lib/strategy/specialist-contract"
import type {
  AdsDerivedSignals,
  AdsLearningLayer,
  AdsRawInputs,
  AdsSignals,
  AdsToolPerformanceEntry,
  PreflightResult,
} from "./types"

export type { AdsToolPerformanceEntry } from "./types"

const HOURS = 3_600_000

export interface PreflightInput {
  mostRecentConversionAt: Date | null
  ga4SyncedAt: Date | null
  gscSyncedAt: Date | null
  tokensValid: { googleAds: boolean; ga4: boolean; gsc: boolean }
  activeCampaignClicks7d: number
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const now = Date.now()
  const reasons: string[] = []

  if (!input.mostRecentConversionAt) {
    reasons.push("Conversion tracking stale: no conversions on record.")
  } else {
    const ageHours = (now - input.mostRecentConversionAt.getTime()) / HOURS
    if (ageHours > T.CONVERSION_FRESHNESS_HOURS) {
      reasons.push(
        `Conversion tracking stale: most recent conversion is ${ageHours.toFixed(1)}h old (threshold ${T.CONVERSION_FRESHNESS_HOURS}h).`,
      )
    }
  }

  if (input.activeCampaignClicks7d < T.MIN_RECENT_CLICKS) {
    reasons.push(
      `Insufficient clicks: ${input.activeCampaignClicks7d} clicks across active campaigns in last ${T.RECENT_CLICKS_WINDOW_DAYS}d (threshold ${T.MIN_RECENT_CLICKS}).`,
    )
  }

  if (!input.tokensValid.googleAds) reasons.push("Google Ads OAuth token invalid or missing.")
  if (!input.tokensValid.ga4) reasons.push("GA4 OAuth token invalid or missing.")
  if (!input.tokensValid.gsc) reasons.push("GSC OAuth token invalid or missing.")

  if (input.ga4SyncedAt) {
    const ga4Lag = (now - input.ga4SyncedAt.getTime()) / HOURS
    if (ga4Lag > T.SYNC_FRESHNESS_HOURS) {
      reasons.push(`GA4 sync lag ${ga4Lag.toFixed(1)}h exceeds ${T.SYNC_FRESHNESS_HOURS}h.`)
    }
  }
  if (input.gscSyncedAt) {
    const gscLag = (now - input.gscSyncedAt.getTime()) / HOURS
    if (gscLag > T.SYNC_FRESHNESS_HOURS) {
      reasons.push(`GSC sync lag ${gscLag.toFixed(1)}h exceeds ${T.SYNC_FRESHNESS_HOURS}h.`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}

export interface RawInputDeps {
  fetchCampaigns: () => Promise<AdsRawInputs["campaigns"]>
  fetchSearchTermsTopSpend: () => Promise<AdsRawInputs["search_terms_top_spend"]>
  fetchSearchTermsTopConversions: () => Promise<AdsRawInputs["search_terms_top_conversions"]>
  fetchPendingRecommendations: () => Promise<AdsRawInputs["pending_recommendations"]>
  fetchConversionActions: () => Promise<AdsRawInputs["conversion_actions"]>
  fetchGa4: () => Promise<AdsRawInputs["ga4"]>
  fetchGscOrganicTop10: () => Promise<AdsRawInputs["gsc_organic_top10"]>
  fetchPipeline: () => Promise<AdsRawInputs["pipeline"]>
  fetchPriorMemos: () => Promise<AdsRawInputs["prior_memos"]>
}

export async function gatherRawInputs(deps: RawInputDeps): Promise<AdsRawInputs> {
  const [
    campaigns,
    search_terms_top_spend,
    search_terms_top_conversions,
    pending_recommendations,
    conversion_actions,
    ga4,
    gsc_organic_top10,
    pipeline,
    prior_memos,
  ] = await Promise.all([
    deps.fetchCampaigns(),
    deps.fetchSearchTermsTopSpend(),
    deps.fetchSearchTermsTopConversions(),
    deps.fetchPendingRecommendations(),
    deps.fetchConversionActions(),
    deps.fetchGa4(),
    deps.fetchGscOrganicTop10(),
    deps.fetchPipeline(),
    deps.fetchPriorMemos(),
  ])
  return {
    campaigns,
    search_terms_top_spend,
    search_terms_top_conversions,
    pending_recommendations,
    conversion_actions,
    ga4,
    gsc_organic_top10,
    pipeline,
    prior_memos,
  }
}

export function deriveCrossChannelSignals(
  raw: AdsRawInputs,
  campaignToLandingPage: Record<string, string> = {},
): AdsDerivedSignals {
  const organicByQuery = new Map(
    raw.gsc_organic_top10.map((g) => [g.query.toLowerCase(), g]),
  )
  const paid_terms_already_organic: AdsDerivedSignals["paid_terms_already_organic"] = []
  for (const term of raw.search_terms_top_spend) {
    if (term.cost_usd < T.PAID_SPEND_THRESHOLD_USD) continue
    const organic = organicByQuery.get(term.text.toLowerCase())
    if (organic && organic.position <= T.ORGANIC_OVERLAP_MAX_POSITION) {
      paid_terms_already_organic.push({
        query: term.text,
        paid_spend_usd: term.cost_usd,
        organic_position: organic.position,
        organic_page: organic.page,
      })
    }
  }

  const paidQueries = new Set(
    [...raw.search_terms_top_spend, ...raw.search_terms_top_conversions].map((t) =>
      t.text.toLowerCase(),
    ),
  )
  const organic_wins_not_in_ads: AdsDerivedSignals["organic_wins_not_in_ads"] = []
  for (const o of raw.gsc_organic_top10) {
    if (o.clicks < T.ORGANIC_WIN_MIN_CLICKS) continue
    if (o.position > T.ORGANIC_WIN_MAX_POSITION) continue
    if (paidQueries.has(o.query.toLowerCase())) continue
    organic_wins_not_in_ads.push({
      query: o.query,
      organic_clicks: o.clicks,
      organic_position: o.position,
    })
  }

  const ctrs = raw.campaigns.map((c) => c.metrics_28d.ctr).sort((a, b) => a - b)
  const p75 = ctrs.length ? ctrs[Math.floor(ctrs.length * 0.75)] : Infinity
  const engagementByPath = new Map(
    raw.ga4.landing_page_engagement.map((e) => [e.page_path, e]),
  )
  const landing_page_engagement_mismatch: AdsDerivedSignals["landing_page_engagement_mismatch"] = []
  for (const c of raw.campaigns) {
    if (c.metrics_28d.ctr < p75) continue
    const lp = campaignToLandingPage[c.id]
    if (!lp) continue
    const eng = engagementByPath.get(lp)
    if (!eng) continue
    if (eng.engagement_rate <= T.LP_ENGAGEMENT_FLOOR) {
      landing_page_engagement_mismatch.push({
        campaign_id: c.id,
        ctr: c.metrics_28d.ctr,
        landing_page: lp,
        engagement_rate: eng.engagement_rate,
      })
    }
  }

  return {
    paid_terms_already_organic,
    organic_wins_not_in_ads,
    landing_page_engagement_mismatch,
  }
}

export function deriveLearningLayer(
  raw: AdsRawInputs,
  now: Date = new Date(),
): AdsLearningLayer {
  const prior_actions_that_worked: AdsLearningLayer["prior_actions_that_worked"] = []
  const prior_actions_that_failed: AdsLearningLayer["prior_actions_that_failed"] = []

  for (const memo of raw.prior_memos) {
    if (memo.outcome_status !== "measured") continue
    const weeks_ago = Math.floor(
      (now.getTime() - new Date(memo.week_of).getTime()) / (7 * 86_400_000),
    )
    for (const action of memo.actions) {
      if (action.status !== "applied") continue
      const args = action.args as Record<string, unknown>
      const key =
        (args.campaign_id as string) ??
        (args.from_campaign_id as string) ??
        action.recommendation_id ??
        ""
      const bucket =
        (memo.outcome_metrics?.[key] as Record<string, number> | undefined) ?? {}
      const delta = bucket[`${action.expected_metric}_delta_pct`] ?? 0
      const moved = action.expected_direction === "increase" ? delta > 0 : delta < 0
      const summary = `${action.tool} on ${key}`
      const entry = { tool: action.tool, args_summary: summary, observed_delta: delta, weeks_ago }
      if (moved && action.significance === "sig") prior_actions_that_worked.push(entry)
      else if (!moved) prior_actions_that_failed.push(entry)
    }
  }

  return {
    winning_keywords: [],
    winning_audiences: [],
    winning_ad_creative: [],
    winning_schedule: [],
    winning_geos: [],
    prior_actions_that_worked,
    prior_actions_that_failed,
  }
}

/**
 * Fetches per-tool ads performance aggregates (last 90 days) by joining the
 * `agent_tool_baselines` rows for the `ads` channel with a rollup of
 * `impact_score` from recently-measured `google_ads_agent_memos`.
 *
 * Returns one entry per baseline tool, in the same ordering as
 * `listChannelBaselines` (n_measured DESC). Returns `[]` when there are no
 * baseline rows yet (cold start).
 */
export async function gatherAdsToolPerformance(
  supabase: SupabaseClient,
): Promise<AdsToolPerformanceEntry[]> {
  const baselines = await listChannelBaselines(supabase, "ads")
  if (baselines.length === 0) return []
  const ninety = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data: memos } = await supabase
    .from("google_ads_agent_memos")
    .select("actions, impact_score")
    .eq("outcome_status", "measured")
    .gte("week_of", ninety)
  const sumByTool: Record<string, { sum: number; count: number }> = {}
  for (const m of (memos ?? []) as Array<{
    actions: Array<{ tool: string }>
    impact_score: number | null
  }>) {
    if (m.impact_score == null) continue
    for (const a of m.actions ?? []) {
      sumByTool[a.tool] ??= { sum: 0, count: 0 }
      sumByTool[a.tool].sum += m.impact_score
      sumByTool[a.tool].count += 1
    }
  }
  return baselines.map((b) => {
    const agg = sumByTool[b.tool_name] ?? { sum: 0, count: 0 }
    return {
      tool: b.tool_name,
      n_measured: b.n_measured,
      avg_impact_score: agg.count > 0 ? Math.round(agg.sum / agg.count) : 0,
      p95_abs_delta: b.p95_abs_delta,
      success_rate: b.success_rate,
    }
  })
}

export interface GatherAdsSignalsDeps extends RawInputDeps {
  fetchPreflightInput: () => Promise<PreflightInput>
  fetchCampaignToLandingPageMap: () => Promise<Record<string, string>>
  /**
   * Returns the latest approved strategy brief (week_of DESC) as a
   * BriefContext, or null if none exists. The Chief Strategist (Task D1's
   * cousin) is the producer; specialists read here. Optional so existing
   * tests can omit it — they'll receive `brief_context: null`.
   */
  fetchBriefContext?: () => Promise<BriefContext | null>
  /**
   * Returns per-tool ads performance aggregates (last 90 days). Optional so
   * existing tests can omit it — they'll receive `tool_performance: []`.
   * Production callers should pass `() => gatherAdsToolPerformance(supabase)`.
   */
  fetchToolPerformance?: () => Promise<AdsToolPerformanceEntry[]>
  /**
   * Returns recent winning few-shot examples from the (global, ads_agent)
   * prompt_templates row. Optional so existing tests can omit it —
   * they'll receive `few_shots: []`. Production callers should pass
   * `() => readFewShots(supabase, "global", "ads_agent")`.
   */
  fetchFewShots?: () => Promise<string[]>
}

export async function gatherAdsSignals(deps: GatherAdsSignalsDeps): Promise<AdsSignals> {
  const generated_at = new Date().toISOString()
  const preflightInput = await deps.fetchPreflightInput()
  const preflight = await runPreflight(preflightInput)
  const brief_context = deps.fetchBriefContext
    ? await deps.fetchBriefContext().catch(() => null)
    : null
  const tool_performance = deps.fetchToolPerformance
    ? await deps.fetchToolPerformance().catch(() => [] as AdsToolPerformanceEntry[])
    : []
  const few_shots = deps.fetchFewShots
    ? await deps.fetchFewShots().catch(() => [] as string[])
    : []
  if (!preflight.ok) {
    return {
      generated_at,
      preflight,
      raw: null,
      derived: null,
      learning: null,
      gaps: ["Preflight failed; raw, derived, and learning skipped."],
      brief_context,
      tool_performance,
      few_shots,
    }
  }
  const gaps: string[] = []
  let raw: AdsRawInputs | null = null
  try {
    raw = await gatherRawInputs(deps)
  } catch (e) {
    gaps.push(`Raw input gather failed: ${(e as Error).message}`)
  }
  let derived = null
  let learning = null
  if (raw) {
    const map = await deps.fetchCampaignToLandingPageMap().catch(() => ({}))
    derived = deriveCrossChannelSignals(raw, map)
    learning = deriveLearningLayer(raw)
  }
  return {
    generated_at,
    preflight,
    raw,
    derived,
    learning,
    gaps,
    brief_context,
    tool_performance,
    few_shots,
  }
}
