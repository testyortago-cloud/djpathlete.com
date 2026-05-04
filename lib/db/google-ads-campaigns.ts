// lib/db/google-ads-campaigns.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsCampaign,
  GoogleAdsAutomationMode,
  GoogleAdsCampaignType,
  GoogleAdsResourceStatus,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface UpsertCampaignInput {
  customer_id: string
  campaign_id: string
  name: string
  type: GoogleAdsCampaignType
  status: GoogleAdsResourceStatus
  bidding_strategy?: string | null
  budget_micros?: number | null
  start_date?: string | null
  end_date?: string | null
  raw_data?: Record<string, unknown> | null
}

export async function listCampaignsForCustomer(customerId: string): Promise<GoogleAdsCampaign[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .select("*")
    .eq("customer_id", customerId)
    .order("name")
  if (error) throw error
  return (data ?? []) as GoogleAdsCampaign[]
}

export async function listAllCampaigns(): Promise<GoogleAdsCampaign[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .select("*")
    .order("customer_id")
    .order("name")
  if (error) throw error
  return (data ?? []) as GoogleAdsCampaign[]
}

export async function getCampaignById(id: string): Promise<GoogleAdsCampaign | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return (data as GoogleAdsCampaign | null) ?? null
}

/**
 * UPSERT preserves the local automation_mode override — it's not in the
 * upsert payload, so an existing row keeps its previously-set mode.
 */
export async function upsertCampaign(input: UpsertCampaignInput): Promise<GoogleAdsCampaign> {
  const supabase = getClient()
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
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsCampaign
}

export async function setAutomationMode(
  id: string,
  mode: GoogleAdsAutomationMode,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_campaigns")
    .update({ automation_mode: mode })
    .eq("id", id)
  if (error) throw error
}
