import { createServiceRoleClient } from "@/lib/supabase"
import type { EventSignup, SignupType } from "@/types/database"
import type { CreateSignupInput } from "@/lib/validators/event-signups"

function getClient() {
  return createServiceRoleClient()
}

export async function getSignupsForEvent(eventId: string): Promise<EventSignup[]> {
  const supabase = getClient()
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
