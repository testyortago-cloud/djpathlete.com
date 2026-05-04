// lib/db/google-ads-search-terms.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsSearchTerm } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertSearchTermInput {
  customer_id: string
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  matched_keyword_id?: string | null
}

export async function upsertSearchTerms(rows: UpsertSearchTermInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getClient()
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

/**
 * Returns search terms whose Google Ads matched_keyword_id is NULL — these
 * are negative-keyword candidates (Plan 1.2 will surface them to the AI).
 */
export async function listRecentUnmatchedSearchTerms(
  customerId: string,
  withinDays: number = 14,
): Promise<GoogleAdsSearchTerm[]> {
  const supabase = getClient()
  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("google_ads_search_terms")
    .select("*")
    .eq("customer_id", customerId)
    .gte("date", since)
    .is("matched_keyword_id", null)
    .order("impressions", { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as GoogleAdsSearchTerm[]
}
