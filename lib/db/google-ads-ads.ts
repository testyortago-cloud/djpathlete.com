// lib/db/google-ads-ads.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsAd, GoogleAdsResourceStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertAdInput {
  ad_group_id: string // local UUID FK
  ad_id: string
  type: string
  status: GoogleAdsResourceStatus
  headlines: Array<{ text: string }>
  descriptions: Array<{ text: string }>
  final_urls: string[]
  raw_data?: Record<string, unknown> | null
}

export async function upsertAd(input: UpsertAdInput): Promise<GoogleAdsAd> {
  const supabase = getClient()
  const { data, error } = await supabase
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
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAd
}

export async function listAdsForAdGroup(adGroupId: string): Promise<GoogleAdsAd[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ads")
    .select("*")
    .eq("ad_group_id", adGroupId)
    .order("ad_id")
  if (error) throw error
  return (data ?? []) as GoogleAdsAd[]
}

/**
 * Resolves an ad_id back to the parent ad_group_id (external) within a
 * specific customer. Used by the apply path to construct mutation resource
 * paths: customers/{customer_id}/adGroupAds/{ad_group_id}~{ad_id}.
 */
export async function resolveAdExternalIds(
  customerId: string,
  adId: string,
): Promise<{ ad_group_id_external: string; ad_id: string } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ads")
    .select(
      "ad_id, ad_group:google_ads_ad_groups!inner(ad_group_id, campaign:google_ads_campaigns!inner(customer_id))",
    )
    .eq("ad_id", adId)
    .eq("ad_group.campaign.customer_id", customerId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const adGroup = (data as unknown as {
    ad_id: string
    ad_group: { ad_group_id: string }
  }).ad_group
  return {
    ad_group_id_external: adGroup.ad_group_id,
    ad_id: (data as { ad_id: string }).ad_id,
  }
}
