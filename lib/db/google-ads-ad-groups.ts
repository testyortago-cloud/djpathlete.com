// lib/db/google-ads-ad-groups.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsAdGroup, GoogleAdsResourceStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertAdGroupInput {
  campaign_id: string // local UUID FK to google_ads_campaigns.id
  ad_group_id: string
  name: string
  status: GoogleAdsResourceStatus
  type?: string | null
  cpc_bid_micros?: number | null
  raw_data?: Record<string, unknown> | null
}

export async function listAdGroupsForCampaign(
  localCampaignId: string,
): Promise<GoogleAdsAdGroup[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ad_groups")
    .select("*")
    .eq("campaign_id", localCampaignId)
    .order("name")
  if (error) throw error
  return (data ?? []) as GoogleAdsAdGroup[]
}

export async function upsertAdGroup(input: UpsertAdGroupInput): Promise<GoogleAdsAdGroup> {
  const supabase = getClient()
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
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAdGroup
}
