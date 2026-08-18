import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

export type BusinessSettings = {
  business_id: string
  display_name: string
  sender_name: string
  sender_email: string
  reply_to: string
  logo_url: string | null
  timezone: string
  quiet_hours_start: number
  quiet_hours_end: number
  daily_message_cap: number
  postal_address: string
  sms_help_text: string
}

function getClient() {
  return createServiceRoleClient()
}

export async function getBusinessSettings(
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<BusinessSettings> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`business_settings row missing for ${businessId}`)
  return data as BusinessSettings
}

export async function updateBusinessSettings(
  patch: Partial<Omit<BusinessSettings, "business_id">>,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<BusinessSettings> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("business_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .select()
    .single()
  if (error) throw error
  return data as BusinessSettings
}
