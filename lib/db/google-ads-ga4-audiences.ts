// lib/db/google-ads-ga4-audiences.ts
// DAL for the GA4 / remarketing audience visibility cache. Read-only mirror
// of non-Customer-Match user_list rows from Google Ads — these flow in via
// the GA4 ↔ Google Ads link, configured in the Google Ads UI (no API to
// create them on our side).

import { createServiceRoleClient } from "@/lib/supabase"
import type { GoogleAdsGa4Audience, GoogleAdsGa4ListType } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listGa4Audiences(): Promise<GoogleAdsGa4Audience[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ga4_audiences")
    .select("*")
    .order("size_for_display", { ascending: false, nullsFirst: false })
    .order("name")
  if (error) throw error
  return (data ?? []) as GoogleAdsGa4Audience[]
}

export interface UpsertGa4AudienceInput {
  customer_id: string
  user_list_id: string
  name: string
  description?: string | null
  list_type: GoogleAdsGa4ListType
  membership_status?: string | null
  size_for_search?: number | null
  size_for_display?: number | null
  membership_life_span_days?: number | null
  raw_data?: Record<string, unknown> | null
}

export async function upsertGa4Audience(
  input: UpsertGa4AudienceInput,
): Promise<GoogleAdsGa4Audience> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ga4_audiences")
    .upsert(
      {
        customer_id: input.customer_id,
        user_list_id: input.user_list_id,
        name: input.name,
        description: input.description ?? null,
        list_type: input.list_type,
        membership_status: input.membership_status ?? null,
        size_for_search: input.size_for_search ?? null,
        size_for_display: input.size_for_display ?? null,
        membership_life_span_days: input.membership_life_span_days ?? null,
        raw_data: input.raw_data ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "customer_id,user_list_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsGa4Audience
}

/**
 * Removes audiences from the cache that weren't part of the latest sync.
 * Called once per customer after a successful pull so deleted/un-shared
 * audiences don't linger in the admin UI.
 */
export async function pruneGa4AudiencesNotInList(
  customerId: string,
  keepUserListIds: string[],
): Promise<number> {
  const supabase = getClient()
  // If the caller has zero kept items, delete everything for this customer
  if (keepUserListIds.length === 0) {
    const { error, count } = await supabase
      .from("google_ads_ga4_audiences")
      .delete({ count: "exact" })
      .eq("customer_id", customerId)
    if (error) throw error
    return count ?? 0
  }
  const { error, count } = await supabase
    .from("google_ads_ga4_audiences")
    .delete({ count: "exact" })
    .eq("customer_id", customerId)
    .not("user_list_id", "in", `(${keepUserListIds.map((id) => `"${id}"`).join(",")})`)
  if (error) throw error
  return count ?? 0
}
