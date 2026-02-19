import { createServiceRoleClient } from "@/lib/supabase"
import type { Payment } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getPayments(userId?: string) {
  const supabase = getClient()
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

export async function getPaymentByStripeId(stripePaymentId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("stripe_payment_id", stripePaymentId)
    .maybeSingle()
  if (error) throw error
  return data as Payment | null
}

export async function getPaymentsWithDetails() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("payments")
    .select("*, users(first_name, last_name, email)")
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as (Payment & {
    users: { first_name: string; last_name: string; email: string } | null
  })[]
}

export async function createPayment(
  payment: Omit<Payment, "id" | "created_at" | "updated_at">
) {
  const supabase = getClient()
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
  const supabase = getClient()
  const { data, error } = await supabase
    .from("payments")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as Payment
}
