import { createServiceRoleClient } from "@/lib/supabase"
import type { SessionFeeCharge, SessionFeeKind } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/**
 * Insert a fee charge, relying on the unique (scheduled_session_id, kind) index
 * for idempotency. Returns null when a charge of this kind already exists for
 * the session (so the caller skips re-charging).
 */
export async function createFeeChargeIfAbsent(c: Omit<SessionFeeCharge, "id" | "created_at">) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_fee_charges")
    .upsert(c, { onConflict: "scheduled_session_id,kind", ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw error
  return data as SessionFeeCharge | null
}

export async function updateFeeCharge(id: string, patch: Partial<SessionFeeCharge>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_fee_charges").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as SessionFeeCharge
}

export async function getFeeChargeById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("session_fee_charges").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data as SessionFeeCharge | null
}

export async function getFeeChargeForSession(scheduledSessionId: string, kind: SessionFeeKind) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_fee_charges")
    .select("*")
    .eq("scheduled_session_id", scheduledSessionId)
    .eq("kind", kind)
    .maybeSingle()
  if (error) throw error
  return data as SessionFeeCharge | null
}

export async function listFeeCharges(limit = 100) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("session_fee_charges")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as SessionFeeCharge[]
}
