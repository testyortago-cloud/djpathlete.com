// functions/src/ads/dal.ts
// Functions-side DAL for Google Ads tables. Single file (vs the Next.js
// side's six) because the orchestrator is the only consumer here.
// Returns local UUIDs (id) for campaigns/ad_groups so children can FK them.

import { getSupabase } from "../lib/supabase.js"
import type {
  GoogleAdsAccount,
  UpsertAdGroupInput,
  UpsertAdInput,
  UpsertCampaignInput,
  UpsertDailyMetricInput,
  UpsertKeywordInput,
  UpsertSearchTermInput,
} from "./types.js"

export async function getActiveGoogleAdsAccounts(): Promise<GoogleAdsAccount[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("customer_id, is_active, last_synced_at, last_error")
    .eq("is_active", true)
  if (error) throw error
  return (data ?? []) as GoogleAdsAccount[]
}

export async function setGoogleAdsAccountSyncResult(
  customer_id: string,
  result: { last_error?: string | null },
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from("google_ads_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.last_error ?? null,
    })
    .eq("customer_id", customer_id)
  if (error) throw error
}

export async function upsertCampaign(
  input: UpsertCampaignInput,
): Promise<{ id: string; campaign_id: string }> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .upsert(
      {
        customer_id: input.customer_id,
        campaign_id: input.campaign_id,
        name: input.name,
        type: input.type,
        status: input.status,
        bidding_strategy: input.bidding_strategy ?? null,
        budget_micros: input.budget_micros ?? null,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "customer_id,campaign_id", ignoreDuplicates: false },
    )
    .select("id, campaign_id")
    .single()
  if (error) throw error
  return data as { id: string; campaign_id: string }
}

export async function upsertAdGroup(
  input: UpsertAdGroupInput,
): Promise<{ id: string; ad_group_id: string }> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("google_ads_ad_groups")
    .upsert(
      {
        campaign_id: input.campaign_id,
        ad_group_id: input.ad_group_id,
        name: input.name,
        status: input.status,
        type: input.type ?? null,
        cpc_bid_micros: input.cpc_bid_micros ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "campaign_id,ad_group_id" },
    )
    .select("id, ad_group_id")
    .single()
  if (error) throw error
  return data as { id: string; ad_group_id: string }
}

export async function upsertKeyword(input: UpsertKeywordInput): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from("google_ads_keywords")
    .upsert(
      {
        ad_group_id: input.ad_group_id,
        criterion_id: input.criterion_id,
        text: input.text,
        match_type: input.match_type,
        status: input.status,
        cpc_bid_micros: input.cpc_bid_micros ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "ad_group_id,criterion_id" },
    )
  if (error) throw error
}

export async function upsertAd(input: UpsertAdInput): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from("google_ads_ads")
    .upsert(
      {
        ad_group_id: input.ad_group_id,
        ad_id: input.ad_id,
        type: input.type,
        status: input.status,
        headlines: input.headlines,
        descriptions: input.descriptions,
        final_urls: input.final_urls,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "ad_group_id,ad_id" },
    )
  if (error) throw error
}

export async function upsertDailyMetrics(rows: UpsertDailyMetricInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getSupabase()
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

export async function upsertSearchTerms(rows: UpsertSearchTermInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getSupabase()
  const payload = rows.map((r) => ({
    customer_id: r.customer_id,
    campaign_id: r.campaign_id,
    ad_group_id: r.ad_group_id,
    search_term: r.search_term,
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    cost_micros: r.cost_micros,
    conversions: r.conversions,
    matched_keyword_id: r.matched_keyword_id ?? null,
    last_synced_at: new Date().toISOString(),
  }))
  let written = 0
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500)
    const { error, count } = await supabase
      .from("google_ads_search_terms")
      .upsert(batch, {
        onConflict: "customer_id,campaign_id,ad_group_id,search_term,date",
        count: "exact",
      })
    if (error) throw error
    written += count ?? batch.length
  }
  return written
}

interface PlatformConnectionRow {
  status: string
  credentials: Record<string, unknown>
}

/**
 * Reads the encrypted refresh token for the google_ads plugin via the
 * SECURITY DEFINER RPC (vault decrypts on the fly). Returns null if the
 * connection is missing or not in 'connected' state.
 */
export async function getGoogleAdsRefreshToken(): Promise<string | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc("fn_get_platform_connection", {
    p_plugin_name: "google_ads",
  })
  if (error) throw error
  const rows = (data ?? []) as PlatformConnectionRow[]
  const row = rows[0]
  if (!row || row.status !== "connected") return null
  const refresh = row.credentials?.refresh_token
  return typeof refresh === "string" ? refresh : null
}
