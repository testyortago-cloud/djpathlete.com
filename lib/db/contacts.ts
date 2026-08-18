// The one entry point every front door calls.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"

export type ContactEventSource =
  | "funnel_form" | "funnel_checkout" | "contact_form" | "newsletter"
  | "lead_magnet" | "event_signup" | "shop" | "assessment"
  | "questionnaire" | "step_up" | "ai_chat"

export type RecordContactEventInput = {
  email?: string | null
  phone?: string | null
  name?: string | null
  source: ContactEventSource
  attributionSessionId?: string | null
  metadata?: Record<string, unknown>
  businessId?: string
}

function getClient() {
  return createServiceRoleClient()
}

// Two separate equality queries, unioned in JS, instead of a single .or()
// filter built by string interpolation. An email or phone value dropped
// straight into PostgREST filter syntax could contain a comma or parenthesis
// and corrupt the filter; .eq() never parses user input as syntax.
async function findMatchCandidates(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  email: string | null,
  phone: string | null,
): Promise<MatchCandidate[]> {
  const byId = new Map<string, MatchCandidate>()

  if (email) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id,email,phone_e164,created_at")
      .eq("business_id", businessId)
      .eq("email", email)
    if (error) throw error
    for (const row of (data ?? []) as MatchCandidate[]) byId.set(row.id, row)
  }

  if (phone) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id,email,phone_e164,created_at")
      .eq("business_id", businessId)
      .eq("phone_e164", phone)
    if (error) throw error
    for (const row of (data ?? []) as MatchCandidate[]) byId.set(row.id, row)
  }

  return Array.from(byId.values())
}

export async function recordContactEvent(
  input: RecordContactEventInput,
): Promise<{ contactId: string; created: boolean; merged: boolean }> {
  const businessId = input.businessId ?? SINGLETON_BUSINESS_ID
  const email = normaliseEmail(input.email)
  const phone = normalisePhone(input.phone)

  if (!email && !phone) {
    throw new Error("recordContactEvent needs at least one usable identifier (email or phone)")
  }

  const supabase = getClient()

  const found = await findMatchCandidates(supabase, businessId, email, phone)
  const decision = decideMerge(found, email, phone)

  let contactId: string
  let created = false
  let merged = false

  if (decision.kind === "create") {
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        business_id: businessId,
        email,
        phone_e164: phone,
        name: input.name ?? null,
        first_touch_session_id: input.attributionSessionId ?? null,
      })
      .select()
      .single()
    if (error) throw error
    contactId = data.id
    created = true
  } else if (decision.kind === "update") {
    contactId = decision.contactId
    await supabase
      .from("contacts")
      .update({
        email: email ?? undefined,
        phone_e164: phone ?? undefined,
        name: input.name ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
  } else {
    contactId = decision.survivorId
    merged = true
    await mergeContacts(decision.survivorId, decision.mergedId, businessId)
    await supabase
      .from("contacts")
      .update({
        email: email ?? undefined,
        phone_e164: phone ?? undefined,
        name: input.name ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
  }

  await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "entry_point",
    source: input.source,
    metadata: input.metadata ?? {},
  })

  return { contactId, created, merged }
}

async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()
  const { data: loser } = await supabase.from("contacts").select("*").eq("id", mergedId).maybeSingle()

  await supabase.from("contact_timeline_events").update({ contact_id: survivorId }).eq("contact_id", mergedId)

  await supabase.from("contact_merges").insert({
    business_id: businessId,
    survivor_id: survivorId,
    merged_id: mergedId,
    merged_snapshot: loser ?? {},
    reason: "email and phone resolved to different contacts",
  })

  await supabase.from("contacts").delete().eq("id", mergedId)
}
