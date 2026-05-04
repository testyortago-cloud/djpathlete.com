// lib/db/google-ads-keywords.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsKeyword,
  GoogleAdsKeywordMatchType,
  GoogleAdsNegativeKeyword,
  GoogleAdsResourceStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertKeywordInput {
  ad_group_id: string // local UUID FK
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  status: GoogleAdsResourceStatus
  cpc_bid_micros?: number | null
  raw_data?: Record<string, unknown> | null
}

export async function upsertKeyword(input: UpsertKeywordInput): Promise<GoogleAdsKeyword> {
  const supabase = getClient()
  const { data, error } = await supabase
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
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsKeyword
}

export async function listKeywordsForAdGroup(adGroupId: string): Promise<GoogleAdsKeyword[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_keywords")
    .select("*")
    .eq("ad_group_id", adGroupId)
    .order("text")
  if (error) throw error
  return (data ?? []) as GoogleAdsKeyword[]
}

/**
 * Resolves a Google Ads criterion_id back to the external IDs needed to build
 * a mutation resource path: customers/{customer_id}/adGroupCriteria/{ad_group_id_external}~{criterion_id}.
 * Returns null if the keyword isn't in our mirror (likely sync lag).
 */
export async function resolveKeywordExternalIds(
  customerId: string,
  criterionId: string,
): Promise<{ ad_group_id_external: string; criterion_id: string; cpc_bid_micros: number | null } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_keywords")
    .select(
      "criterion_id, cpc_bid_micros, ad_group:google_ads_ad_groups!inner(ad_group_id, campaign:google_ads_campaigns!inner(customer_id))",
    )
    .eq("criterion_id", criterionId)
    .eq("ad_group.campaign.customer_id", customerId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const adGroup = (data as unknown as {
    criterion_id: string
    cpc_bid_micros: number | null
    ad_group: { ad_group_id: string }
  }).ad_group
  return {
    ad_group_id_external: adGroup.ad_group_id,
    criterion_id: (data as { criterion_id: string }).criterion_id,
    cpc_bid_micros: (data as { cpc_bid_micros: number | null }).cpc_bid_micros,
  }
}

export interface UpsertNegativeKeywordInput {
  customer_id: string
  scope_type: "campaign" | "ad_group"
  scope_id: string
  criterion_id: string
  text: string
  match_type: GoogleAdsKeywordMatchType
  raw_data?: Record<string, unknown> | null
}

export async function upsertNegativeKeyword(
  input: UpsertNegativeKeywordInput,
): Promise<GoogleAdsNegativeKeyword> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_negative_keywords")
    .upsert(
      {
        customer_id: input.customer_id,
        scope_type: input.scope_type,
        scope_id: input.scope_id,
        criterion_id: input.criterion_id,
        text: input.text,
        match_type: input.match_type,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "customer_id,scope_type,scope_id,criterion_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsNegativeKeyword
}
