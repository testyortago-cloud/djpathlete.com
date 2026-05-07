// lib/db/google-ads-metrics.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsDailyMetric } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertDailyMetricInput {
  customer_id: string
  campaign_id: string
  ad_group_id?: string | null
  keyword_criterion_id?: string | null
  date: string // YYYY-MM-DD
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value: number
  raw_data?: Record<string, unknown> | null
}

/**
 * Bulk-UPSERT in batches of 500 to stay well under Supabase's row-payload limit.
 * The unique-index `idx_google_ads_daily_metrics_unique` includes COALESCE
 * over ad_group_id + keyword_criterion_id, but Supabase's upsert API needs the
 * raw column names — Postgres infers the partial-index match from the constraint
 * tuple. Using `(customer_id,campaign_id,ad_group_id,keyword_criterion_id,date)`
 * matches because NULLs in the input are normalized to '' by the index expr.
 */
export async function upsertDailyMetrics(rows: UpsertDailyMetricInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getClient()
  const payload = rows.map((r) => ({
    customer_id: r.customer_id,
    campaign_id: r.campaign_id,
    ad_group_id: r.ad_group_id ?? null,
    keyword_criterion_id: r.keyword_criterion_id ?? null,
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    cost_micros: r.cost_micros,
    conversions: r.conversions,
    conversion_value: r.conversion_value,
    raw_data: r.raw_data ?? null,
    last_synced_at: new Date().toISOString(),
  }))
  let written = 0
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error, count } = await supabase
      .from("google_ads_daily_metrics")
      .upsert(batch, {
        onConflict: "customer_id,campaign_id,ad_group_id,keyword_criterion_id,date",
        count: "exact",
      })
    if (error) throw error
    written += count ?? batch.length
  }
  return written
}

export async function getDailyMetricsForCampaign(
  campaignId: string,
  fromDate: string,
  toDate: string,
): Promise<GoogleAdsDailyMetric[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("*")
    .eq("campaign_id", campaignId)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date")
  if (error) throw error
  return (data ?? []) as GoogleAdsDailyMetric[]
}

export interface CampaignMetricsRollup {
  campaign_id: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversion_value: number
}

/**
 * Sum metrics by campaign_id over [fromDate, toDate]. Used by the dashboard
 * to render a "last 7 days" column without fetching every row to the client.
 * Aggregation runs against the campaign-grain rows only (ad_group_id IS NULL
 * AND keyword_criterion_id IS NULL) to avoid double-counting.
 */
export interface AdsTotals {
  cost_micros: number
  conversions: number
  clicks: number
  impressions: number
}

export async function getDailyTotalsInRange(from: Date, to: Date): Promise<AdsTotals> {
  const supabase = getClient()
  const fromYmd = from.toISOString().slice(0, 10)
  const toYmd = to.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("cost_micros, conversions, clicks, impressions")
    .is("ad_group_id", null)
    .is("keyword_criterion_id", null)
    .gte("date", fromYmd)
    .lt("date", toYmd)
  if (error) throw error
  const rows = (data ?? []) as Array<{
    cost_micros: number; conversions: number; clicks: number; impressions: number
  }>
  return rows.reduce<AdsTotals>(
    (acc, r) => ({
      cost_micros: acc.cost_micros + Number(r.cost_micros ?? 0),
      conversions: acc.conversions + Number(r.conversions ?? 0),
      clicks: acc.clicks + Number(r.clicks ?? 0),
      impressions: acc.impressions + Number(r.impressions ?? 0),
    }),
    { cost_micros: 0, conversions: 0, clicks: 0, impressions: 0 },
  )
}

export async function getCampaignRollup(
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, CampaignMetricsRollup>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_daily_metrics")
    .select("campaign_id, impressions, clicks, cost_micros, conversions, conversion_value")
    .eq("customer_id", customerId)
    .is("ad_group_id", null)
    .is("keyword_criterion_id", null)
    .gte("date", fromDate)
    .lte("date", toDate)
  if (error) throw error
  const rows = (data ?? []) as Array<{
    campaign_id: string
    impressions: number
    clicks: number
    cost_micros: number
    conversions: number
    conversion_value: number
  }>
  const out = new Map<string, CampaignMetricsRollup>()
  for (const r of rows) {
    const cur = out.get(r.campaign_id) ?? {
      campaign_id: r.campaign_id,
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
      conversion_value: 0,
    }
    cur.impressions += Number(r.impressions ?? 0)
    cur.clicks += Number(r.clicks ?? 0)
    cur.cost_micros += Number(r.cost_micros ?? 0)
    cur.conversions += Number(r.conversions ?? 0)
    cur.conversion_value += Number(r.conversion_value ?? 0)
    out.set(r.campaign_id, cur)
  }
  return out
}
