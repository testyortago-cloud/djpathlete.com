// lib/db/google-ads-accounts.ts
import { createServiceRoleClient } from "@/lib/supabase"
import { platformBusinessId } from "@/lib/tenancy/platform"
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
 * `businessId` DEFAULTS, and it is the one tenant default left in lib/db —
 * deliberately, and inventoried under DELIBERATELY FROZEN in
 * lib/tenancy/platform.ts. Five callers in the ads subsystem (lib/ads/agent.ts
 * twice, lib/ads/ga4-audiences.ts, lib/ads/conversions.ts's value-adjustment
 * path, app/api/admin/ads/diagnose/route.ts) pass nothing, and that subsystem
 * is scoped as a unit or not at all: /admin/ads and /api/admin/ads are
 * owner-only precisely because listGoogleAdsAccounts above has no tenant
 * filter (docs/superpowers/plans/2026-09-04-ads-owner-only.md). A NEW caller
 * passes one.
 *
 * functions/src/ads/dal.ts:getActiveGoogleAdsAccounts is a SEPARATE Firebase
 * twin of this function, not a caller of it (functions/ cannot import from
 * lib/ — see CLAUDE.md). It now carries its own `businessId` predicate too
 * (added alongside upsertGoogleAdsAccount's write half below), so the two
 * stay in sync — update both if this one's filtering logic ever changes.
 */
export async function getActiveGoogleAdsAccounts(
  businessId: string = platformBusinessId(),
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

/** Re-discovery must not silently move an ad account between coaches. */
export class AdsAccountOwnedByAnotherBusinessError extends Error {
  constructor(customerId: string, ownerBusinessId: string) {
    super(`Google Ads account ${customerId} already belongs to business ${ownerBusinessId}`)
    this.name = "AdsAccountOwnedByAnotherBusinessError"
  }
}

/**
 * The write half of the per-tenant reader above. `businessId` is REQUIRED
 * and gets written on every INSERT, so a second business can finally have an
 * ads account of its own — until this changed, every OAuth-discovered
 * account landed on the column's default (the platform business), which is
 * exactly why getActiveGoogleAdsAccounts could filter by business_id and
 * still find every account: there was only one business that had any.
 *
 * Still matches an existing row on `customer_id` ALONE, not
 * `(customer_id, business_id)` — and that is deliberate, not a leftover gap.
 * `customer_id` is the PRIMARY KEY on `google_ads_accounts`, and nine other
 * tables (`google_ads_campaigns`, `_ad_groups`, `_keywords`, two tables in
 * migration 00106, `_recommendations`, `_user_lists`, two in 00118, and
 * `_ga4_audiences`) carry a foreign key referencing it. A composite key is
 * not available without dropping the primary key, adding a surrogate, and
 * rewriting all nine child FKs — and it would model something false anyway:
 * a Google Ads customer id *is* one real ad account, so it genuinely belongs
 * to exactly one business, never two.
 *
 * Because of that, re-discovery finding a customer_id that already belongs
 * to a DIFFERENT business cannot be treated as "this business's account
 * too" — it throws AdsAccountOwnedByAnotherBusinessError instead of
 * silently reassigning it (or silently ignoring the mismatch and updating
 * someone else's row).
 */
export async function upsertGoogleAdsAccount(
  account: UpsertGoogleAdsAccountInput,
  businessId: string,
): Promise<GoogleAdsAccount> {
  const supabase = getClient()
  // Split insert vs update so OAuth re-discovery doesn't clobber the admin's
  // manual is_active=false decisions on sub-accounts they don't run ads in.
  //  - existing row → UPDATE metadata only, leave is_active alone
  //  - missing row  → INSERT with is_active=true (newly discovered accounts
  //                   default to active)
  const { data: existing, error: existingError } = await supabase
    .from("google_ads_accounts")
    .select("customer_id, business_id")
    .eq("customer_id", account.customer_id)
    .maybeSingle()
  // PostgREST resolves rather than throws. Left unchecked, a failed read here
  // reads as "no existing row" and falls through to the INSERT below — which
  // would either 23505 against another business's row, or worse, silently
  // reassign it if the primary key ever changed. A failed read is not a
  // miss: surface it.
  if (existingError) throw existingError

  if (existing && existing.business_id !== businessId) {
    throw new AdsAccountOwnedByAnotherBusinessError(account.customer_id, existing.business_id)
  }

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
      business_id: businessId,
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
