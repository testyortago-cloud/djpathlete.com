import { createServiceRoleClient } from "@/lib/supabase"
import type { MarketingConsentLog } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface ConsentChange {
  user_id: string
  granted: boolean
  source: string
  ip_address?: string | null
  user_agent?: string | null
}

/**
 * Set marketing consent for a user (or revoke), and write an audit log row.
 * Idempotent: re-granting consent is a no-op (returns null log row).
 */
export async function setMarketingConsent(change: ConsentChange): Promise<MarketingConsentLog | null> {
  const supabase = getClient()

  // Read current state to dedupe
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("marketing_consent_at")
    .eq("id", change.user_id)
    .single()
  if (userErr) throw userErr

  const isCurrentlyGranted = user.marketing_consent_at != null
  if (isCurrentlyGranted === change.granted) return null

  const updates = change.granted
    ? { marketing_consent_at: new Date().toISOString(), marketing_consent_source: change.source }
    : { marketing_consent_at: null, marketing_consent_source: null }

  const { error: updErr } = await supabase
    .from("users")
    .update(updates)
    .eq("id", change.user_id)
  if (updErr) throw updErr

  const { data: logRow, error: logErr } = await supabase
    .from("marketing_consent_log")
    .insert({
      user_id: change.user_id,
      granted: change.granted,
      source: change.source,
      ip_address: change.ip_address ?? null,
      user_agent: change.user_agent ?? null,
    })
    .select()
    .single()
  if (logErr) throw logErr

  return logRow as MarketingConsentLog
}

export async function listConsentLog(limit = 200): Promise<MarketingConsentLog[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("marketing_consent_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as MarketingConsentLog[]
}
