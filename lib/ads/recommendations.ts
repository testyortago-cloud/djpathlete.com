// lib/ads/recommendations.ts
// AI recommendations engine — for each active campaign, builds a tight
// snapshot of recent metrics + search terms + keyword performance, asks
// Claude for structured recommendations, validates against the Zod schema,
// then persists to google_ads_recommendations as 'pending'.
//
// Plan 1.3 will consume the resulting rows: approval queue → apply path →
// automation_log row per attempt. Plan 1.2 stops at persisting suggestions.

import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import {
  recommendationBatchSchema,
  type RecommendationBatch,
} from "@/lib/validators/ads"
import { listCampaignsForCustomer } from "@/lib/db/google-ads-campaigns"
import { listKeywordsForAdGroup } from "@/lib/db/google-ads-keywords"
import { listAdGroupsForCampaign } from "@/lib/db/google-ads-ad-groups"
import {
  getDailyMetricsForCampaign,
  getCampaignRollup,
} from "@/lib/db/google-ads-metrics"
import { listRecentUnmatchedSearchTerms } from "@/lib/db/google-ads-search-terms"
import {
  insertRecommendations,
  type InsertRecommendationInput,
} from "@/lib/db/google-ads-recommendations"
import type {
  GoogleAdsCampaign,
  GoogleAdsRecommendation,
} from "@/types/database"

const METRICS_LOOKBACK_DAYS = 28
const SEARCH_TERM_LOOKBACK_DAYS = 14
const TOP_KEYWORDS_PER_CAMPAIGN = 50

const SYSTEM_PROMPT = `You are an experienced Google Ads strategist with deep
expertise in single-advertiser direct-response campaigns for a personal-brand
fitness coaching business (DJP Athlete). Your job is to read recent campaign
performance and propose specific, evidence-backed optimizations.

Hard constraints — violate any of these and the recommendation will be
rejected:
- Only suggest negative keywords for search terms with ≥10 impressions and 0
  conversions over the last 14 days. Cite the specific search term in the
  reasoning.
- Only suggest bid changes between -50% and +50% of the current bid. Larger
  swings are too risky for nightly automation.
- Pause-keyword recommendations require ≥100 clicks and a CTR < 1% over the
  last 28 days. Branded keywords (containing the advertiser's name) are
  exempt — never suggest pausing them.
- Every recommendation MUST cite the metric basis in the reasoning field
  (e.g., "Search term 'free workout' had 47 impressions, 0 conversions over
  14 days").
- Confidence: 0.9+ means "I would auto-apply this"; 0.7-0.9 means "near
  certain, but worth a human glance"; <0.7 means "directional".
- Return at most 10 recommendations per call. Quality > quantity. If nothing
  meets the bar for this campaign, return an empty list — do not invent.
- For Performance Max campaigns, only return recommendations of type
  'add_ad_variant' (asset additions). Google's optimizer manages everything
  else — external bid/keyword recs conflict with its signals.

Output format: a JSON object matching the provided schema exactly. The
'payload' field shape varies by recommendation_type:
- add_negative_keyword:  { text: string, match_type: "EXACT"|"PHRASE"|"BROAD" }
- adjust_bid:            { current_micros: number, proposed_micros: number }
- pause_keyword:         { criterion_id: string }
- add_keyword:           { text: string, match_type: "EXACT"|"PHRASE"|"BROAD",
                           initial_cpc_bid_micros?: number }
- add_ad_variant:        { headlines: string[], descriptions: string[],
                           final_url: string }
- pause_ad:              { ad_id: string }

scope_id must match the entity:
- recommendation_type starts with "add_" + scope is "campaign" → campaign_id
- "pause_keyword" or "adjust_bid" on a keyword → criterion_id
- "pause_ad" → ad_id`

interface CampaignSnapshot {
  campaign: GoogleAdsCampaign
  metrics_28d: {
    impressions: number
    clicks: number
    cost_micros: number
    conversions: number
    conversion_value: number
    ctr: number
    avg_cpc_micros: number
  }
  top_keywords: Array<{
    criterion_id: string
    text: string
    match_type: string
    cpc_bid_micros: number | null
    impressions: number
    clicks: number
    cost_micros: number
    conversions: number
    ctr: number
  }>
  unmatched_search_terms: Array<{
    search_term: string
    impressions: number
    clicks: number
    conversions: number
  }>
}

function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

async function buildCampaignSnapshot(
  campaign: GoogleAdsCampaign,
): Promise<CampaignSnapshot> {
  const fromDate = isoDate(METRICS_LOOKBACK_DAYS)
  const toDate = isoDate(0)

  // Campaign-grain rollup
  const rollupMap = await getCampaignRollup(campaign.customer_id, fromDate, toDate)
  const rollup = rollupMap.get(campaign.campaign_id) ?? {
    campaign_id: campaign.campaign_id,
    impressions: 0,
    clicks: 0,
    cost_micros: 0,
    conversions: 0,
    conversion_value: 0,
  }

  // Keyword-grain metrics (top 50 by impressions)
  const allDailyMetrics = await getDailyMetricsForCampaign(campaign.id, fromDate, toDate)
  const byCriterion = new Map<
    string,
    { impressions: number; clicks: number; cost_micros: number; conversions: number }
  >()
  for (const m of allDailyMetrics) {
    if (!m.keyword_criterion_id) continue
    const cur = byCriterion.get(m.keyword_criterion_id) ?? {
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
    }
    cur.impressions += Number(m.impressions)
    cur.clicks += Number(m.clicks)
    cur.cost_micros += Number(m.cost_micros)
    cur.conversions += Number(m.conversions)
    byCriterion.set(m.keyword_criterion_id, cur)
  }

  // Resolve criterion_id → keyword text (need to walk ad_groups → keywords)
  const adGroups = await listAdGroupsForCampaign(campaign.id)
  const keywordsByCriterion = new Map<
    string,
    { text: string; match_type: string; cpc_bid_micros: number | null }
  >()
  for (const ag of adGroups) {
    const keywords = await listKeywordsForAdGroup(ag.id)
    for (const kw of keywords) {
      keywordsByCriterion.set(kw.criterion_id, {
        text: kw.text,
        match_type: kw.match_type,
        cpc_bid_micros: kw.cpc_bid_micros,
      })
    }
  }

  const topKeywords = Array.from(byCriterion.entries())
    .map(([criterion_id, m]) => {
      const kw = keywordsByCriterion.get(criterion_id)
      const ctr = m.impressions > 0 ? m.clicks / m.impressions : 0
      return {
        criterion_id,
        text: kw?.text ?? "(unknown)",
        match_type: kw?.match_type ?? "BROAD",
        cpc_bid_micros: kw?.cpc_bid_micros ?? null,
        impressions: m.impressions,
        clicks: m.clicks,
        cost_micros: m.cost_micros,
        conversions: m.conversions,
        ctr,
      }
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, TOP_KEYWORDS_PER_CAMPAIGN)

  // Unmatched search terms (negative-keyword candidates)
  const searchTerms = await listRecentUnmatchedSearchTerms(
    campaign.customer_id,
    SEARCH_TERM_LOOKBACK_DAYS,
  )
  // Aggregate by term across days, scoped to this campaign
  const termAgg = new Map<
    string,
    { impressions: number; clicks: number; conversions: number }
  >()
  for (const s of searchTerms) {
    if (s.campaign_id !== campaign.campaign_id) continue
    const cur = termAgg.get(s.search_term) ?? { impressions: 0, clicks: 0, conversions: 0 }
    cur.impressions += Number(s.impressions)
    cur.clicks += Number(s.clicks)
    cur.conversions += Number(s.conversions)
    termAgg.set(s.search_term, cur)
  }
  const unmatchedSearchTerms = Array.from(termAgg.entries())
    .filter(([, m]) => m.impressions >= 10 && m.conversions === 0)
    .map(([search_term, m]) => ({ search_term, ...m }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 50)

  const ctr = rollup.impressions > 0 ? rollup.clicks / rollup.impressions : 0
  const avgCpcMicros = rollup.clicks > 0 ? Math.round(rollup.cost_micros / rollup.clicks) : 0

  return {
    campaign,
    metrics_28d: { ...rollup, ctr, avg_cpc_micros: avgCpcMicros },
    top_keywords: topKeywords,
    unmatched_search_terms: unmatchedSearchTerms,
  }
}

function snapshotToUserMessage(snap: CampaignSnapshot): string {
  const c = snap.campaign
  const m = snap.metrics_28d
  const lines: string[] = []
  lines.push(`# Campaign: ${c.name}`)
  lines.push(
    `Type: ${c.type}  Status: ${c.status}  Bidding: ${c.bidding_strategy ?? "(none)"}  Mode: ${c.automation_mode}`,
  )
  lines.push(`Customer ID: ${c.customer_id}  Campaign ID: ${c.campaign_id}`)
  lines.push("")
  lines.push("## Last 28 days (campaign grain)")
  lines.push(
    `impressions=${m.impressions}  clicks=${m.clicks}  cost_micros=${m.cost_micros}  ` +
      `conversions=${m.conversions.toFixed(2)}  conversion_value=${m.conversion_value.toFixed(2)}  ` +
      `ctr=${(m.ctr * 100).toFixed(2)}%  avg_cpc_micros=${m.avg_cpc_micros}`,
  )
  lines.push("")
  lines.push("## Top keywords (by impressions, last 28 days)")
  if (snap.top_keywords.length === 0) {
    lines.push("(no keyword-grain metrics recorded yet)")
  } else {
    for (const k of snap.top_keywords) {
      lines.push(
        `- ${JSON.stringify(k.text)} [${k.match_type}] criterion_id=${k.criterion_id} ` +
          `bid=${k.cpc_bid_micros ?? "—"} ` +
          `imp=${k.impressions} clk=${k.clicks} cost=${k.cost_micros} conv=${k.conversions.toFixed(2)} ` +
          `ctr=${(k.ctr * 100).toFixed(2)}%`,
      )
    }
  }
  lines.push("")
  lines.push(
    "## Unmatched search terms with 0 conversions and ≥10 impressions (last 14 days)",
  )
  if (snap.unmatched_search_terms.length === 0) {
    lines.push("(none)")
  } else {
    for (const s of snap.unmatched_search_terms) {
      lines.push(
        `- ${JSON.stringify(s.search_term)}  imp=${s.impressions} clk=${s.clicks} conv=${s.conversions}`,
      )
    }
  }
  lines.push("")
  lines.push(
    "Return the recommendations JSON object. Empty `recommendations` array is acceptable if nothing meets the bar.",
  )
  return lines.join("\n")
}

export interface RunRecommendationsOptions {
  /**
   * Override which campaigns to score. Default: every campaign with status
   * != REMOVED for the given customer.
   */
  campaignIds?: string[]
  /**
   * Cap how many campaigns to score in one run. Default 50 — prevents the
   * AI from torching tokens on a freshly-imported account with hundreds of
   * stale campaigns.
   */
  maxCampaigns?: number
  /**
   * Optional model override (default: Sonnet).
   */
  model?: string
}

export interface RunRecommendationsResult {
  campaigns_scored: number
  campaigns_skipped: number
  recommendations_generated: number
  recommendations_persisted: number
  tokens_used: number
}

/**
 * Walks every active campaign for `customerId`, asks Claude for
 * recommendations, and persists each as a 'pending' row. Skips campaigns
 * that have no metrics yet (freshly synced empty accounts).
 *
 * Never throws on per-campaign failure — captures the error in the result
 * counters so the next campaign gets its turn.
 */
export async function runRecommendationsForCustomer(
  customerId: string,
  options: RunRecommendationsOptions = {},
): Promise<RunRecommendationsResult> {
  const allCampaigns = await listCampaignsForCustomer(customerId)
  const eligible = allCampaigns
    .filter((c) => c.status !== "REMOVED")
    .filter((c) => !options.campaignIds || options.campaignIds.includes(c.id))
    .slice(0, options.maxCampaigns ?? 50)

  const result: RunRecommendationsResult = {
    campaigns_scored: 0,
    campaigns_skipped: 0,
    recommendations_generated: 0,
    recommendations_persisted: 0,
    tokens_used: 0,
  }

  for (const campaign of eligible) {
    let snapshot: CampaignSnapshot
    try {
      snapshot = await buildCampaignSnapshot(campaign)
    } catch (err) {
      console.error(`[recommendations] snapshot failed for ${campaign.id}:`, err)
      result.campaigns_skipped++
      continue
    }

    // Skip campaigns with zero data — Claude would just hallucinate
    if (
      snapshot.metrics_28d.impressions === 0 &&
      snapshot.top_keywords.length === 0 &&
      snapshot.unmatched_search_terms.length === 0
    ) {
      result.campaigns_skipped++
      continue
    }

    let batch: RecommendationBatch
    let tokens = 0
    try {
      const userMessage = snapshotToUserMessage(snapshot)
      const aiResult = await callAgent(
        SYSTEM_PROMPT,
        userMessage,
        recommendationBatchSchema,
        { model: options.model ?? MODEL_SONNET, cacheSystemPrompt: true },
      )
      batch = aiResult.content
      tokens = aiResult.tokens_used
    } catch (err) {
      console.error(`[recommendations] Claude call failed for ${campaign.id}:`, err)
      result.campaigns_skipped++
      continue
    }

    result.campaigns_scored++
    result.tokens_used += tokens
    result.recommendations_generated += batch.recommendations.length

    if (batch.recommendations.length === 0) continue

    const inserts: InsertRecommendationInput[] = batch.recommendations.map((r) => ({
      customer_id: customerId,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      recommendation_type: r.recommendation_type,
      payload: r.payload,
      reasoning: r.reasoning,
      confidence: r.confidence,
    }))
    try {
      const persisted = await insertRecommendations(inserts)
      result.recommendations_persisted += persisted.length
    } catch (err) {
      console.error(`[recommendations] persist failed for ${campaign.id}:`, err)
    }
  }

  return result
}

/**
 * Convenience export for tests + the internal API endpoint.
 */
export async function runRecommendationsForAllActiveAccounts(
  customerIds: string[],
  options: RunRecommendationsOptions = {},
): Promise<Record<string, RunRecommendationsResult>> {
  const out: Record<string, RunRecommendationsResult> = {}
  for (const customerId of customerIds) {
    out[customerId] = await runRecommendationsForCustomer(customerId, options)
  }
  return out
}

export type { GoogleAdsRecommendation }
