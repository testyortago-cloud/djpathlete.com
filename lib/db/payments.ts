import { createServerSupabaseClient } from "@/lib/supabase"
import type { Payment } from "@/types/database"

export async function getPayments(userId?: string) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false })
  if (userId) {
    query = query.eq("user_id", userId)
  }
  const { data, error } = await query
  if (error) throw error
  return data as Payment[]
}

export async function createPayment(
  payment: Omit<Payment, "id" | "created_at" | "updated_at">
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("payments")
    .insert(payment)
    .select()
    .single()
  if (error) throw error
  return data as Payment
}

export async function updatePayment(
  id: string,
  updates: Partial<Omit<Payment, "id" | "created_at">>
) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from("payments")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Payment
}
