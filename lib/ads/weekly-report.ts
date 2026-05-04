// lib/ads/weekly-report.ts
// Composes the data + HTML for the Weekly Google Ads Report email.
// Called by /api/admin/internal/ads/weekly-report (Monday 13:00 UTC).

import { createElement } from "react"
import { createServiceRoleClient } from "@/lib/supabase"
import { listGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { listAllCampaigns } from "@/lib/db/google-ads-campaigns"
import { listRecommendations } from "@/lib/db/google-ads-recommendations"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import { z } from "zod"
import {
  WeeklyAdsReport,
  type AdsCampaignSummary,
  type AdsKeywordSummary,
  type AdsRecommendationSummary,
  type AdsTotals,
  type AdsTotalsDelta,
} from "@/components/emails/WeeklyAdsReport"
import type { GoogleAdsRecommendation } from "@/types/database"

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

interface RangeRollup {
  cost_micros: number
  clicks: number
  conversions: number
  conversion_value: number
  impressions: number
}

async function fetchRangeRollup(
  customerIds: string[],
  fromDate: string,
  toDate: string,
): Promise<RangeRollup> {
  if (customerIds.length === 0) {
    return { cost_micros: 0, clicks: 0, conversions: 0, conversion_value: 0, impressions: 0 }
  }
  const supabase = createServiceRoleClient()
  // Aggregate at campaign grain only (rows where ad_group_id IS NULL AND
  // keyword_criterion_id IS NULL) so we don't double-count.
  const { data, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("cost_micros, clicks, conversions, conversion_value, impressions")
    .in("customer_id", customerIds)
    .is("ad_group_id", null)
    .is("keyword_criterion_id", null)
    .gte("date", fromDate)
    .lte("date", toDate)
  if (error) throw error
  const rollup: RangeRollup = {
    cost_micros: 0,
    clicks: 0,
    conversions: 0,
    conversion_value: 0,
    impressions: 0,
  }
  for (const r of (data ?? []) as Array<RangeRollup>) {
    rollup.cost_micros += Number(r.cost_micros)
    rollup.clicks += Number(r.clicks)
    rollup.conversions += Number(r.conversions)
    rollup.conversion_value += Number(r.conversion_value)
    rollup.impressions += Number(r.impressions)
  }
  return rollup
}

async function fetchTopCampaigns(
  customerIds: string[],
  fromDate: string,
  toDate: string,
  limit: number,
): Promise<AdsCampaignSummary[]> {
  if (customerIds.length === 0) return []
  const supabase = createServiceRoleClient()
  // Pull metrics aggregated per (customer_id, campaign_id), then join names
  const { data: metrics, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("customer_id, campaign_id, cost_micros, clicks, conversions, conversion_value")
    .in("customer_id", customerIds)
    .is("ad_group_id", null)
    .is("keyword_criterion_id", null)
    .gte("date", fromDate)
    .lte("date", toDate)
  if (error) throw error
  type MetricRow = {
    customer_id: string
    campaign_id: string
    cost_micros: number
    clicks: number
    conversions: number
    conversion_value: number
  }
  const byKey = new Map<string, MetricRow>()
  for (const r of (metrics ?? []) as MetricRow[]) {
    const key = `${r.customer_id}|${r.campaign_id}`
    const cur = byKey.get(key) ?? { ...r, cost_micros: 0, clicks: 0, conversions: 0, conversion_value: 0 }
    cur.cost_micros += Number(r.cost_micros)
    cur.clicks += Number(r.clicks)
    cur.conversions += Number(r.conversions)
    cur.conversion_value += Number(r.conversion_value)
    byKey.set(key, cur)
  }
  const campaigns = await listAllCampaigns()
  const campaignByKey = new Map<string, { name: string; type: string; status: string }>()
  for (const c of campaigns) {
    campaignByKey.set(`${c.customer_id}|${c.campaign_id}`, {
      name: c.name,
      type: c.type,
      status: c.status,
    })
  }
  const summaries: AdsCampaignSummary[] = Array.from(byKey.entries())
    .map(([key, m]) => {
      const meta = campaignByKey.get(key) ?? { name: key, type: "UNKNOWN", status: "UNKNOWN" }
      return {
        name: meta.name,
        type: meta.type,
        status: meta.status,
        cost_micros: m.cost_micros,
        clicks: m.clicks,
        conversions: m.conversions,
        conversion_value: m.conversion_value,
      }
    })
    .sort((a, b) => b.conversion_value - a.conversion_value)
    .slice(0, limit)
  return summaries
}

async function fetchWorstKeywords(
  customerIds: string[],
  fromDate: string,
  toDate: string,
  limit: number,
): Promise<AdsKeywordSummary[]> {
  if (customerIds.length === 0) return []
  const supabase = createServiceRoleClient()
  const { data: metrics, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("keyword_criterion_id, cost_micros, clicks, conversions")
    .in("customer_id", customerIds)
    .not("keyword_criterion_id", "is", null)
    .gte("date", fromDate)
    .lte("date", toDate)
  if (error) throw error
  type MetricRow = {
    keyword_criterion_id: string
    cost_micros: number
    clicks: number
    conversions: number
  }
  const byCriterion = new Map<string, MetricRow>()
  for (const r of (metrics ?? []) as MetricRow[]) {
    const cur = byCriterion.get(r.keyword_criterion_id) ?? {
      ...r,
      cost_micros: 0,
      clicks: 0,
      conversions: 0,
    }
    cur.cost_micros += Number(r.cost_micros)
    cur.clicks += Number(r.clicks)
    cur.conversions += Number(r.conversions)
    byCriterion.set(r.keyword_criterion_id, cur)
  }
  const offenders = Array.from(byCriterion.entries())
    .filter(([, m]) => m.cost_micros > 0 && m.conversions === 0)
    .sort((a, b) => b[1].cost_micros - a[1].cost_micros)
    .slice(0, limit)
  if (offenders.length === 0) return []
  const ids = offenders.map(([id]) => id)
  const { data: keywords, error: kwErr } = await supabase
    .from("google_ads_keywords")
    .select("criterion_id, text, match_type")
    .in("criterion_id", ids)
  if (kwErr) throw kwErr
  type KeywordRow = { criterion_id: string; text: string; match_type: string }
  const meta = new Map<string, KeywordRow>()
  for (const k of (keywords ?? []) as KeywordRow[]) meta.set(k.criterion_id, k)
  return offenders.map(([id, m]) => {
    const k = meta.get(id)
    return {
      text: k?.text ?? `(criterion ${id})`,
      match_type: k?.match_type ?? "BROAD",
      cost_micros: m.cost_micros,
      clicks: m.clicks,
      conversions: m.conversions,
    }
  })
}

const insightsSchema = z.object({ paragraph: z.string().min(40).max(800) })

async function generateInsightsParagraph(input: {
  totals: AdsTotals
  delta: AdsTotalsDelta
  topCampaigns: AdsCampaignSummary[]
  worstKeywords: AdsKeywordSummary[]
  pendingCount: number
}): Promise<string> {
  const summary = JSON.stringify({
    cost_dollars: input.totals.cost_micros / 1_000_000,
    conversions: input.totals.conversions,
    cpa_dollars: input.totals.cpa_micros / 1_000_000,
    delta: input.delta,
    top_campaigns: input.topCampaigns.slice(0, 3).map((c) => ({
      name: c.name,
      type: c.type,
      conversions: c.conversions,
      conversion_value: c.conversion_value,
    })),
    worst_keywords: input.worstKeywords.slice(0, 3).map((k) => ({
      text: k.text,
      cost_dollars: k.cost_micros / 1_000_000,
    })),
    pending_recommendations: input.pendingCount,
  })
  try {
    const { content } = await callAgent(
      "You are a senior marketing analyst writing the weekly Google Ads digest for one advertiser (DJP Athlete coaching). Tone: direct, brief, opinionated. 2-4 sentences total. Lead with the most consequential signal (spend trend, CPA trend, top win, or biggest leak). Cite numbers. End with one concrete next action the advertiser should consider this week.",
      `Last week's data:\n${summary}\n\nReturn { "paragraph": "..." } only.`,
      insightsSchema,
      { model: MODEL_HAIKU, cacheSystemPrompt: true },
    )
    return content.paragraph
  } catch (err) {
    console.error("[weekly-ads-report] insights generation failed:", err)
    // Graceful fallback so the email still goes out
    return `Spend was ${(input.totals.cost_micros / 1_000_000).toFixed(2)} with ${Math.round(input.totals.conversions)} conversions and ${input.pendingCount} pending recommendations to review. AI insights unavailable this week — see the dashboard for full context.`
  }
}

export interface WeeklyAdsReportData {
  subject: string
  html: string
  rangeStart: Date
  rangeEnd: Date
  totals: AdsTotals
  delta: AdsTotalsDelta
  topCampaigns: AdsCampaignSummary[]
  worstKeywords: AdsKeywordSummary[]
  pendingCount: number
}

export async function buildWeeklyAdsReport(
  options: { rangeEnd?: Date } = {},
): Promise<WeeklyAdsReportData> {
  const rangeEnd = options.rangeEnd ?? new Date()
  const rangeStart = new Date(rangeEnd.getTime() - 7 * 86_400_000)
  const previousStart = new Date(rangeStart.getTime() - 7 * 86_400_000)

  const accounts = await listGoogleAdsAccounts()
  const activeIds = accounts.filter((a) => a.is_active).map((a) => a.customer_id)

  const [current, previous] = await Promise.all([
    fetchRangeRollup(activeIds, isoDate(rangeStart), isoDate(rangeEnd)),
    fetchRangeRollup(activeIds, isoDate(previousStart), isoDate(rangeStart)),
  ])

  const ctr = current.impressions > 0 ? current.clicks / current.impressions : 0
  const cpaMicros = current.conversions > 0 ? Math.round(current.cost_micros / current.conversions) : 0
  const prevCpaMicros = previous.conversions > 0 ? Math.round(previous.cost_micros / previous.conversions) : 0

  const totals: AdsTotals = {
    cost_micros: current.cost_micros,
    clicks: current.clicks,
    conversions: current.conversions,
    conversion_value: current.conversion_value,
    ctr,
    cpa_micros: cpaMicros,
  }
  const delta: AdsTotalsDelta = {
    cost_micros_pct: pctDelta(current.cost_micros, previous.cost_micros),
    conversions_pct: pctDelta(current.conversions, previous.conversions),
    cpa_micros_pct: pctDelta(cpaMicros, prevCpaMicros),
  }

  const [topCampaigns, worstKeywords, pendingRecs] = await Promise.all([
    fetchTopCampaigns(activeIds, isoDate(rangeStart), isoDate(rangeEnd), 5),
    fetchWorstKeywords(activeIds, isoDate(rangeStart), isoDate(rangeEnd), 5),
    listRecommendations({ status: "pending", limit: 200 }),
  ])

  const topPendingRecs = pendingRecs
    .slice(0, 3)
    .map((r: GoogleAdsRecommendation): AdsRecommendationSummary => ({
      recommendation_type: r.recommendation_type,
      scope: `${r.scope_type} ${r.scope_id}`,
      reasoning: r.reasoning,
      confidence: r.confidence,
    }))

  const insightsParagraph = await generateInsightsParagraph({
    totals,
    delta,
    topCampaigns,
    worstKeywords,
    pendingCount: pendingRecs.length,
  })

  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/ads/recommendations`

  const subject = `Google Ads — Week of ${rangeStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`

  const html = await renderEmail(
    createElement(WeeklyAdsReport, {
      rangeStart,
      rangeEnd,
      totals,
      delta,
      topCampaigns,
      worstKeywords,
      pendingCount: pendingRecs.length,
      topPendingRecs,
      insightsParagraph,
      dashboardUrl,
    }),
  )

  return {
    subject,
    html,
    rangeStart,
    rangeEnd,
    totals,
    delta,
    topCampaigns,
    worstKeywords,
    pendingCount: pendingRecs.length,
  }
}
