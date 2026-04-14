import { createServiceRoleClient } from "@/lib/supabase"
import type { EventSignup, SignupType } from "@/types/database"
import type { CreateSignupInput } from "@/lib/validators/event-signups"

function getClient() {
  return createServiceRoleClient()
}

export async function getSignupsForEvent(eventId: string): Promise<EventSignup[]> {
  const supabase = getClient()

  // On-read sweep: stale paid pending rows (>1 hour old) become cancelled.
  // The capacity guard's time window already excludes them; this keeps the
  // admin table tidy without a scheduled job.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await supabase
    .from("event_signups")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("signup_type", "paid")
    .eq("status", "pending")
    .lt("created_at", oneHourAgo)

  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as EventSignup[]
}

export async function getSignupById(id: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("event_signups").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}

export async function createSignup(
  eventId: string,
  input: CreateSignupInput,
  signupType: SignupType,
): Promise<EventSignup> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .insert({ event_id: eventId, signup_type: signupType, ...input })
    .select()
    .single()
  if (error) throw error
  return data as EventSignup
}

export type ConfirmResult = { ok: true } | { ok: false; reason: "not_found" | "not_pending" | "at_capacity" }
export type CancelResult = { ok: true } | { ok: false; reason: "not_found" | "not_cancellable" }

export async function confirmSignup(id: string): Promise<ConfirmResult> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("confirm_event_signup", { p_signup_id: id })
  if (error) throw error
  return data as ConfirmResult
}

export async function cancelSignup(id: string): Promise<CancelResult> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("cancel_event_signup", { p_signup_id: id })
  if (error) throw error
  return data as CancelResult
}

export async function countPendingPaidSignups(eventId: string): Promise<number> {
  const supabase = getClient()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("event_signups")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("signup_type", "paid")
    .eq("status", "pending")
    .gte("created_at", oneHourAgo)
  if (error) throw error
  return count ?? 0
}

export async function getEventSignupByStripeSessionId(sessionId: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}

export async function getEventSignupByPaymentIntent(piId: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("stripe_payment_intent_id", piId)
    .maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}
