// lib/db/google-ads-conversion-actions.ts
// DAL for the admin-configured map between local triggers
// (booking_created / payment_succeeded) and Google Ads ConversionAction
// resource IDs. The conversion uploads worker reads this on every drain.

import { createServiceRoleClient } from "@/lib/supabase"
import type {
  GoogleAdsConversionAction,
  GoogleAdsConversionTrigger,
} from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listConversionActions(): Promise<GoogleAdsConversionAction[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_actions")
    .select("*")
    .order("trigger_type")
  if (error) throw error
  return (data ?? []) as GoogleAdsConversionAction[]
}

export async function getActiveConversionAction(
  customerId: string,
  trigger: GoogleAdsConversionTrigger,
): Promise<GoogleAdsConversionAction | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_actions")
    .select("*")
    .eq("customer_id", customerId)
    .eq("trigger_type", trigger)
    .eq("is_active", true)
    .maybeSingle()
  if (error) throw error
  return (data as GoogleAdsConversionAction | null) ?? null
}

export interface UpsertConversionActionInput {
  customer_id: string
  conversion_action_id: string
  name: string
  trigger_type: GoogleAdsConversionTrigger
  default_value_micros: number
  default_currency?: string
  is_active?: boolean
}

export async function upsertConversionAction(
  input: UpsertConversionActionInput,
): Promise<GoogleAdsConversionAction> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_conversion_actions")
    .upsert(
      {
        customer_id: input.customer_id,
        conversion_action_id: input.conversion_action_id,
        name: input.name,
        trigger_type: input.trigger_type,
        default_value_micros: input.default_value_micros,
        default_currency: input.default_currency ?? "USD",
        is_active: input.is_active ?? true,
      },
      { onConflict: "customer_id,trigger_type" },
    )
    .select()
    .single()
  if (error) throw error
  return data as GoogleAdsConversionAction
}

export async function deleteConversionAction(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("google_ads_conversion_actions").delete().eq("id", id)
  if (error) throw error
}
