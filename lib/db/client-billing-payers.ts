import { createServiceRoleClient } from "@/lib/supabase"
import type { ClientBillingPayer } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getBillingPayer(clientUserId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_billing_payers")
    .select("*")
    .eq("client_user_id", clientUserId)
    .maybeSingle()
  if (error) throw error
  return data as ClientBillingPayer | null
}

export async function setBillingPayer(clientUserId: string, payerUserId: string, createdBy: string | null) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("client_billing_payers")
    .upsert(
      { client_user_id: clientUserId, payer_user_id: payerUserId, created_by: createdBy, updated_at: new Date().toISOString() },
      { onConflict: "client_user_id" },
    )
    .select()
    .single()
  if (error) throw error
  return data as ClientBillingPayer
}

export async function clearBillingPayer(clientUserId: string) {
  const supabase = getClient()
  const { error } = await supabase.from("client_billing_payers").delete().eq("client_user_id", clientUserId)
  if (error) throw error
}
