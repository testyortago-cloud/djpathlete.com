import { createServiceRoleClient } from "@/lib/supabase"
import type { Payment } from "@/types/database"

/** Service-role client bypasses RLS — these functions are only called from server-side routes. */
function getClient() {
  return createServiceRoleClient()
}

export async function getPayments(userId?: string) {
  const supabase = getClient()
  let query = supabase.from("payments").select("*").order("created_at", { ascending: false })
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

export async function getPaymentsWithDetails(limit?: number) {
  const supabase = getClient()
  let query = supabase
    .from("payments")
    .select("*, users(first_name, last_name, email)")
    .order("created_at", { ascending: false })
  if (limit) query = query.limit(limit)
  const { data, error } = await query
  if (error) throw error
  return data as (Payment & {
    users: { first_name: string; last_name: string; email: string } | null
  })[]
}

export async function createPayment(payment: Omit<Payment, "id" | "created_at" | "updated_at">) {
  const supabase = getClient()
  const { data, error } = await supabase.from("payments").insert(payment).select().single()
  if (error) throw error
  return data as Payment
}

export async function updatePayment(id: string, updates: Partial<Omit<Payment, "id" | "created_at">>) {
  const supabase = getClient()
  const { data, error } = await supabase.from("payments").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as Payment
}

/**
 * Feeds the Lead Engine pipeline reconciler (lib/automation/pipeline-reconcile.ts,
 * Task 6): succeeded payments written since `sinceIso`. `succeeded` only —
 * pending/failed/refunded payments never move a card. `payments` covers
 * every product this business sells, not just coaching consults, so this is
 * deliberately broad; `metadata` is included so the reconciler can exclude
 * the specific non-coaching payment types it has confirmed actually reach
 * this table (`NON_COACHING_PAYMENT_TYPES` in pipeline-reconcile.ts) before
 * replaying a row through `applyPipelineEvent`.
 */
export async function getSucceededPaymentsForPipelineReconcile(
  sinceIso: string,
): Promise<Pick<Payment, "id" | "user_id" | "amount_cents" | "currency" | "created_at" | "metadata">[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("payments")
    .select("id, user_id, amount_cents, currency, created_at, metadata")
    .eq("status", "succeeded")
    .gte("created_at", sinceIso)
  if (error) throw error
  return (data ?? []) as Pick<
    Payment,
    "id" | "user_id" | "amount_cents" | "currency" | "created_at" | "metadata"
  >[]
}
