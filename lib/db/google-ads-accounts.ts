// lib/db/google-ads-accounts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import type { GoogleAdsAccount } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listGoogleAdsAccounts(): Promise<GoogleAdsAccount[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("*")
    .order("descriptive_name", { ascending: true })
  if (error) throw error
  return (data ?? []) as GoogleAdsAccount[]
}

/**
 * `businessId` defaults to the singleton because four existing callers
 * (lib/ads/agent.ts twice, lib/ads/ga4-audiences.ts, and the value-adjustment
 * path in lib/ads/conversions.ts) pre-date multi-tenancy and are correct with
 * it. New callers pass one. The default-parameter idiom stays on EXISTING DAL
 * functions for one migration and is removed caller by caller; a NEW function
 * that defaults the tenant is how the next leak ships.
 */
export async function getActiveGoogleAdsAccounts(
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<GoogleAdsAccount[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
  if (error) throw error
  return (data ?? []) as GoogleAdsAccount[]
}

export interface UpsertGoogleAdsAccountInput {
  customer_id: string
  manager_customer_id?: string | null
  descriptive_name?: string | null
  currency_code?: string | null
  time_zone?: string | null
  connected_at?: string | null
}

export async function upsertGoogleAdsAccount(
  account: UpsertGoogleAdsAccountInput,
): Promise<GoogleAdsAccount> {
  const supabase = getClient()
  // Split insert vs update so OAuth re-discovery doesn't clobber the admin's
  // manual is_active=false decisions on sub-accounts they don't run ads in.
  //  - existing row → UPDATE metadata only, leave is_active alone
  //  - missing row  → INSERT with is_active=true (newly discovered accounts
  //                   default to active)
  const { data: existing } = await supabase
    .from("google_ads_accounts")
    .select("customer_id")
    .eq("customer_id", account.customer_id)
    .maybeSingle()

  const metadataPatch = {
    manager_customer_id: account.manager_customer_id ?? null,
    descriptive_name: account.descriptive_name ?? null,
    currency_code: account.currency_code ?? null,
    time_zone: account.time_zone ?? null,
    last_error: null,
  }

  if (existing) {
    const { data, error } = await supabase
      .from("google_ads_accounts")
      .update(metadataPatch)
      .eq("customer_id", account.customer_id)
      .select()
      .single()
    if (error) throw error
    return data as GoogleAdsAccount
  }

  const { data, error } = await supabase
    .from("google_ads_accounts")
    .insert({
      customer_id: account.customer_id,
      ...metadataPatch,
      connected_at: account.connected_at ?? new Date().toISOString(),
      is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsAccount
}

export async function setGoogleAdsAccountSyncResult(
  customer_id: string,
  result: { last_error?: string | null },
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.last_error ?? null,
    })
    .eq("customer_id", customer_id)
  if (error) throw error
}

export async function deactivateGoogleAdsAccount(customer_id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("google_ads_accounts")
    .update({ is_active: false })
    .eq("customer_id", customer_id)
  if (error) throw error
}
