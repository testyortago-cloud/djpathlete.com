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
 * `businessId` defaults to the singleton because five existing callers in the
 * Next.js runtime (lib/ads/agent.ts twice, lib/ads/ga4-audiences.ts, the
 * value-adjustment path in lib/ads/conversions.ts, and
 * app/api/admin/ads/diagnose/route.ts) pre-date multi-tenancy and are correct
 * with it. New callers pass one. The default-parameter idiom stays on
 * EXISTING DAL functions for one migration and is removed caller by caller; a
 * NEW function that defaults the tenant is how the next leak ships.
 *
 * functions/src/ads/dal.ts:getActiveGoogleAdsAccounts is a SEPARATE Firebase
 * twin of this function, not a caller of it (functions/ cannot import from
 * lib/ — see CLAUDE.md), and it applies NO business filter at all. Safe today
 * only because every account is still on the singleton (see
 * upsertGoogleAdsAccount below); it becomes a cross-tenant leak the day a
 * second business has an account and nobody has updated that twin.
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

/**
 * SINGLETON-ONLY BY CONSTRUCTION: this function never takes or writes a
 * business_id, and matches an existing row on customer_id alone. Every
 * OAuth-discovered account therefore lands on the column default
 * (SINGLETON_BUSINESS_ID), which is exactly why getActiveGoogleAdsAccounts
 * above can filter by business_id today and still find every account —
 * there is only one business that has any. That also means
 * enqueueBookingConversion returns null, permanently and silently, for
 * every OTHER business: a lookup keyed on a column this function never
 * writes just returns empty, which reads exactly like "nothing to do".
 * Correct for this phase (a business with no configured account is meant
 * to enqueue nothing) but NOT a general per-tenant write path. Giving a
 * second business its own Google Ads account requires this function to
 * take a business_id, write it on insert, and match on
 * (customer_id, business_id) rather than customer_id alone — phase-1 scope,
 * not implemented here.
 */
export async function upsertGoogleAdsAccount(
  account: UpsertGoogleAdsAccountInput,
): Promise<GoogleAdsAccount> {
  const supabase = getClient()
  // Split insert vs update so OAuth re-discovery doesn't clobber the admin's
  // manual is_active=false decisions on sub-accounts they don't run ads in.
  //  - existing row → UPDATE metadata only, leave is_active alone
  //  - missing row  → INSERT with is_active=true (newly discovered accounts
  //                   default to active)
  const { data: existing, error: existingError } = await supabase
    .from("google_ads_accounts")
    .select("customer_id")
    .eq("customer_id", account.customer_id)
    .maybeSingle()
  // PostgREST resolves rather than throws. Left unchecked, a failed read here
  // reads as "no existing row" and falls through to the INSERT below, which
  // then fails with a confusing 23505 instead of surfacing the real error.
  if (existingError) throw existingError

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
