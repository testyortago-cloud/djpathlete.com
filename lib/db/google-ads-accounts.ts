// lib/db/google-ads-accounts.ts
import { createServiceRoleClient } from "@/lib/supabase"
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

export async function getActiveGoogleAdsAccounts(): Promise<GoogleAdsAccount[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("*")
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
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .upsert(
      {
        customer_id: account.customer_id,
        manager_customer_id: account.manager_customer_id ?? null,
        descriptive_name: account.descriptive_name ?? null,
        currency_code: account.currency_code ?? null,
        time_zone: account.time_zone ?? null,
        connected_at: account.connected_at ?? new Date().toISOString(),
        is_active: true,
        last_error: null,
      },
      { onConflict: "customer_id" },
    )
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
