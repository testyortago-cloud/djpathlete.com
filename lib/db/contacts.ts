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

// Applies a patch to the contacts row and throws on failure. Used for both
// the plain-update path and the post-merge patch of the survivor: recording
// who this person is must never fail silently.
async function updateContact(
  supabase: ReturnType<typeof createServiceRoleClient>,
  contactId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase.from("contacts").update(patch).eq("id", contactId)
  if (error) throw error
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
    await updateContact(supabase, contactId, {
      email: email ?? undefined,
      phone_e164: phone ?? undefined,
      name: input.name ?? undefined,
      updated_at: new Date().toISOString(),
    })
  } else {
    contactId = decision.survivorId
    merged = true
    await mergeContacts(decision.survivorId, decision.mergedId, businessId)
    await updateContact(supabase, contactId, {
      email: email ?? undefined,
      phone_e164: phone ?? undefined,
      name: input.name ?? undefined,
      updated_at: new Date().toISOString(),
    })
  }

  // A timeline row is history, not the record of who this person is. The
  // contact write above already succeeded (or this function would already
  // have thrown), so a failure here must not fail an entry point that has
  // already captured the lead. Log it with enough context to find and
  // backfill, and return normally.
  const { error: timelineError } = await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "entry_point",
    source: input.source,
    metadata: input.metadata ?? {},
  })
  if (timelineError) {
    console.error(
      `recordContactEvent: failed to append timeline event for contact ${contactId} (source: ${input.source})`,
      timelineError,
    )
  }

  return { contactId, created, merged }
}

// NOT transactional. Supabase REST cannot span statements, so this makes
// three independent round-trips: re-point the loser's timeline rows, record
// the merge audit row, delete the loser. If the process dies between the
// audit insert and the delete, the loser row is left undeleted with the
// audit row already recorded. That is the residual window — it is not closed
// here; it is left to Stage 1b, which needs database-level primitives (a
// plpgsql function) to close it for real.
//
// What IS guaranteed: a retry is safe. Before inserting the audit row, this
// checks whether one already exists for this exact (survivor_id, merged_id)
// pair and skips the insert if so, so re-running this function after a crash
// re-merges correctly instead of doubling the audit trail.
//
// Timeline rows are re-pointed BEFORE the delete, and that order must not
// change: contact_timeline_events.contact_id cascades on delete, so deleting
// the loser first would destroy its timeline history before it could be
// moved to the survivor.
export async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()

  const { data: loser, error: loserError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", mergedId)
    .maybeSingle()
  if (loserError) throw loserError

  const { error: repointError } = await supabase
    .from("contact_timeline_events")
    .update({ contact_id: survivorId })
    .eq("contact_id", mergedId)
  if (repointError) throw repointError

  const { data: existingMerge, error: existingMergeError } = await supabase
    .from("contact_merges")
    .select("id")
    .eq("survivor_id", survivorId)
    .eq("merged_id", mergedId)
    .maybeSingle()
  if (existingMergeError) throw existingMergeError

  if (!existingMerge) {
    const { error: mergeInsertError } = await supabase.from("contact_merges").insert({
      business_id: businessId,
      survivor_id: survivorId,
      merged_id: mergedId,
      merged_snapshot: loser ?? {},
      reason: "email and phone resolved to different contacts",
    })
    if (mergeInsertError) throw mergeInsertError
  }

  const { error: deleteError } = await supabase.from("contacts").delete().eq("id", mergedId)
  if (deleteError) throw deleteError
}
