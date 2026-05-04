// lib/ads/ga4-audiences.ts
// Phase 1.5e — pulls non-Customer-Match user_list rows from Google Ads
// (those flow in via the GA4 ↔ Google Ads link, set up in the Google Ads
// UI) and mirrors them into google_ads_ga4_audiences for in-app
// visibility. Customer Match (CRM_BASED) lists are managed by Plan 1.5b
// and excluded here.
//
// Soft-skips on missing GOOGLE_ADS_DEVELOPER_TOKEN — admin UI surfaces
// the empty state with a setup checklist for the GA4 link.

import { getActiveGoogleAdsAccounts } from "@/lib/db/google-ads-accounts"
import { getCustomerClient } from "@/lib/ads/google-ads-client"
import {
  pruneGa4AudiencesNotInList,
  upsertGa4Audience,
} from "@/lib/db/google-ads-ga4-audiences"
import type { GoogleAdsGa4ListType } from "@/types/database"

const VALID_TYPES: GoogleAdsGa4ListType[] = [
  "REMARKETING",
  "RULE_BASED",
  "LOGICAL",
  "SIMILAR",
  "LOOKALIKE",
  "EXTERNAL_REMARKETING",
]

function coerceListType(raw: unknown): GoogleAdsGa4ListType {
  return VALID_TYPES.includes(raw as GoogleAdsGa4ListType)
    ? (raw as GoogleAdsGa4ListType)
    : "UNKNOWN"
}

interface UserListRow {
  user_list?: {
    id?: string | number
    name?: string
    description?: string | null
    type?: string
    membership_status?: string | null
    size_for_search?: number | null
    size_for_display?: number | null
    membership_life_span?: number | null
  }
}

export interface SyncGa4AudiencesResult {
  customers_processed: number
  customers_failed: number
  audiences_upserted: number
  audiences_pruned: number
  skipped_no_token: boolean
}

export async function syncGa4Audiences(): Promise<SyncGa4AudiencesResult> {
  const result: SyncGa4AudiencesResult = {
    customers_processed: 0,
    customers_failed: 0,
    audiences_upserted: 0,
    audiences_pruned: 0,
    skipped_no_token: false,
  }

  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    result.skipped_no_token = true
    return result
  }

  const accounts = await getActiveGoogleAdsAccounts()
  for (const account of accounts) {
    try {
      const customer = await getCustomerClient(account.customer_id)
      // Pull every user_list except CRM_BASED (Customer Match — managed by 1.5b).
      const rows = await customer.query(`
        SELECT user_list.id, user_list.name, user_list.description, user_list.type,
               user_list.membership_status, user_list.size_for_search,
               user_list.size_for_display, user_list.membership_life_span
        FROM user_list
        WHERE user_list.type != 'CRM_BASED'
          AND user_list.read_only = FALSE
      `)
      const seen: string[] = []
      for (const row of rows as unknown[]) {
        const list = (row as UserListRow).user_list
        if (!list || list.id == null) continue
        const userListId = String(list.id)
        seen.push(userListId)
        await upsertGa4Audience({
          customer_id: account.customer_id,
          user_list_id: userListId,
          name: list.name ?? "(unnamed)",
          description: list.description ?? null,
          list_type: coerceListType(list.type),
          membership_status: list.membership_status ?? null,
          size_for_search:
            list.size_for_search != null ? Number(list.size_for_search) : null,
          size_for_display:
            list.size_for_display != null ? Number(list.size_for_display) : null,
          membership_life_span_days:
            list.membership_life_span != null ? Number(list.membership_life_span) : null,
          raw_data: row as Record<string, unknown>,
        })
        result.audiences_upserted++
      }
      const pruned = await pruneGa4AudiencesNotInList(account.customer_id, seen)
      result.audiences_pruned += pruned
      result.customers_processed++
    } catch (err) {
      console.error(`[ga4-audiences] customer ${account.customer_id} failed:`, err)
      result.customers_failed++
    }
  }

  return result
}
