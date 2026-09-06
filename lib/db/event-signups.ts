import { createServiceRoleClient } from "@/lib/supabase"
import type { EventSignup, SignupType } from "@/types/database"
import type { CreateSignupInput } from "@/lib/validators/event-signups"

// The DAL persists the athlete/parent fields plus waiver acceptance metadata.
// `waiver_accepted` from the API schema is just a boolean affirmation — it
// doesn't get persisted as-is; the server-side waiver document id, timestamp,
// IP, and user agent are stored instead. `sms_consent` is the same shape of
// thing (Lead Engine Stage 4): a boolean affirmation with no column of its
// own on `event_signups` — evidence of it is filed separately, as a
// `contact_consents` row, by whichever route the signup came through.
export type CreateSignupDbInput = Omit<CreateSignupInput, "waiver_accepted" | "sms_consent">

function getClient() {
  return createServiceRoleClient()
}

export async function getSignupsForEvent(businessId: string, eventId: string): Promise<EventSignup[]> {
  const supabase = getClient()

  // On-read sweep: stale paid pending rows (>1 hour old) become cancelled.
  // The capacity guard's time window already excludes them; this keeps the
  // admin table tidy without a scheduled job. This is a WRITE, so it needs
  // the tenant predicate as much as the select below does — without it, one
  // tenant's read could flip another tenant's stale rows to cancelled.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await supabase
    .from("event_signups")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .eq("signup_type", "paid")
    .eq("status", "pending")
    .lt("created_at", oneHourAgo)

  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as EventSignup[]
}

export async function getSignupById(businessId: string, id: string): Promise<EventSignup | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  return (data as EventSignup) ?? null
}

export interface WaiverAcceptance {
  document_id: string | null
  ip_address: string | null
  user_agent: string | null
}

export interface SignupTracking {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
}

export async function createSignup(
  businessId: string,
  eventId: string,
  input: CreateSignupDbInput,
  signupType: SignupType,
  waiver?: WaiverAcceptance,
  tracking?: SignupTracking,
): Promise<EventSignup> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .insert({
      event_id: eventId,
      business_id: businessId,
      signup_type: signupType,
      ...input,
      waiver_accepted_at: waiver ? new Date().toISOString() : null,
      waiver_document_id: waiver?.document_id ?? null,
      waiver_ip_address: waiver?.ip_address ?? null,
      waiver_user_agent: waiver?.user_agent ?? null,
      gclid: tracking?.gclid ?? null,
      gbraid: tracking?.gbraid ?? null,
      wbraid: tracking?.wbraid ?? null,
      fbclid: tracking?.fbclid ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as EventSignup
}

export type ConfirmResult = { ok: true } | { ok: false; reason: "not_found" | "not_pending" | "at_capacity" }
export type CancelResult = { ok: true } | { ok: false; reason: "not_found" | "not_cancellable" }

export async function confirmSignup(businessId: string, id: string): Promise<ConfirmResult> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("confirm_event_signup", {
    p_signup_id: id,
    p_business_id: businessId,
  })
  if (error) throw error
  return data as ConfirmResult
}

export async function cancelSignup(businessId: string, id: string): Promise<CancelResult> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("cancel_event_signup", {
    p_signup_id: id,
    p_business_id: businessId,
  })
  if (error) throw error
  return data as CancelResult
}

/**
 * DELIBERATELY NOT SCOPED BY businessId. A Stripe checkout-session id is
 * issued by Stripe and globally unique, so it names exactly one signup and
 * cannot be guessed into another tenant's rows — the id IS the authorisation.
 * Adding a tenant argument here would be theatre: every caller would have to
 * invent one, and the two that exist (the success page and the webhook) have
 * no better answer than the row itself.
 *
 * Its CALLERS still check: the camps/clinics success pages compare the
 * returned row's business_id against the host's resolved business and 404 on
 * a mismatch, so this cannot be used to display another tenant's customer.
 *
 * An unscoped reader with a written argument is a decision; an unscoped
 * reader without one is a defect. Do not delete this comment to "clean up".
 */
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

/**
 * DELIBERATELY NOT SCOPED BY businessId. A Stripe payment-intent id is
 * issued by Stripe and globally unique, so it names exactly one signup and
 * cannot be guessed into another tenant's rows — the id IS the authorisation.
 * Adding a tenant argument here would be theatre: the caller would have to
 * invent one, and it has no better answer than the row itself.
 *
 * Its ONLY caller is `handleEventSignupRefund` in
 * app/api/stripe/webhook/route.ts, a webhook — there is no Host header to
 * resolve a tenant from and nothing to compare the row against, unlike the
 * camps/clinics success pages (see getEventSignupByStripeSessionId's doc
 * comment above). The webhook instead DERIVES the tenant FROM the returned
 * row: it reads `signup.id` and `signup.status` off the row this function
 * hands back and acts on that same row, never on a second, independently
 * looked-up one — so there is no second value for a wrong-tenant row to be
 * substituted into.
 *
 * An unscoped reader with a written argument is a decision; an unscoped
 * reader without one is a defect. Do not delete this comment to "clean up".
 */
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

export async function listSignupsCreatedSince(businessId: string, since: Date): Promise<EventSignup[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("event_signups")
    .select("*")
    .eq("business_id", businessId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as EventSignup[]
}
