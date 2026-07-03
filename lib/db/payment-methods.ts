import { createServiceRoleClient } from "@/lib/supabase"
import type { UserPaymentMethod } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getDefaultPaymentMethod(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("user_payment_methods")
    .select("*")
    .eq("user_id", userId)
    .eq("is_default", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as UserPaymentMethod | null
}

/**
 * Store a newly-saved card as the default, demoting any previous default first
 * so exactly one card is default per user.
 */
export async function upsertDefaultPaymentMethod(pm: Omit<UserPaymentMethod, "id" | "created_at">) {
  const supabase = getClient()
  await supabase.from("user_payment_methods").update({ is_default: false }).eq("user_id", pm.user_id)
  const { data, error } = await supabase
    .from("user_payment_methods")
    .upsert({ ...pm, is_default: true }, { onConflict: "stripe_payment_method_id" })
    .select()
    .single()
  if (error) throw error
  return data as UserPaymentMethod
}

export async function deletePaymentMethod(id: string) {
  const supabase = getClient()
  const { error } = await supabase.from("user_payment_methods").delete().eq("id", id)
  if (error) throw error
}
