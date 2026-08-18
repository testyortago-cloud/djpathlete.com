// The one entry point every front door calls.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"
import { enrollIfTriggered } from "@/lib/lead-engine/enroll"

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

type IdentifierConflict = { field: "email" | "phone"; submitted: string; existing: string }

// A public form must never let a submitted identifier silently overwrite a
// different one already on file — that is how a double-submit or a shared
// device rewrites a stranger's email. An identifier is only ever WRITTEN when
// the contact's current value for it is null (a fill). A submission carrying
// a different non-null value is reported as a conflict instead, so the caller
// can record it rather than discard it.
function buildIdentifierPatch(
  existing: { email: string | null; phone_e164: string | null } | null,
  email: string | null,
  phone: string | null,
): { patch: Record<string, unknown>; conflicts: IdentifierConflict[] } {
  const patch: Record<string, unknown> = {}
  const conflicts: IdentifierConflict[] = []

  if (email) {
    if (!existing?.email) {
      patch.email = email
    } else if (existing.email !== email) {
      conflicts.push({ field: "email", submitted: email, existing: existing.email })
    }
  }

  if (phone) {
    if (!existing?.phone_e164) {
      patch.phone_e164 = phone
    } else if (existing.phone_e164 !== phone) {
      conflicts.push({ field: "phone", submitted: phone, existing: existing.phone_e164 })
    }
  }

  return { patch, conflicts }
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
  let identifierConflicts: IdentifierConflict[] = []

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
    const existing = found.find((c) => c.id === contactId) ?? null
    const built = buildIdentifierPatch(existing, email, phone)
    identifierConflicts = built.conflicts
    await updateContact(supabase, contactId, {
      ...built.patch,
      name: input.name ?? undefined,
      updated_at: new Date().toISOString(),
    })
  } else {
    contactId = decision.survivorId
    merged = true
    // Pre-merge candidates already include the survivor's current identifier
    // values; the merge itself never touches them, so this lookup stays valid.
    const existing = found.find((c) => c.id === contactId) ?? null
    await mergeContacts(decision.survivorId, decision.mergedId, businessId)
    const built = buildIdentifierPatch(existing, email, phone)
    identifierConflicts = built.conflicts
    await updateContact(supabase, contactId, {
      ...built.patch,
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

  // A conflicting identifier is never silently discarded: it did not
  // overwrite the record, so it is recorded on the timeline instead, one row
  // per conflicting field.
  for (const conflict of identifierConflicts) {
    const { error: conflictError } = await supabase.from("contact_timeline_events").insert({
      business_id: businessId,
      contact_id: contactId,
      kind: "identifier_conflict",
      source: input.source,
      metadata: { field: conflict.field, submitted: conflict.submitted, existing: conflict.existing },
    })
    if (conflictError) {
      console.error(
        `recordContactEvent: failed to append identifier_conflict event for contact ${contactId} (field: ${conflict.field})`,
        conflictError,
      )
    }
  }

  // Enrolment is marketing; the contact record is the thing that matters.
  // Losing an enrolment is recoverable, losing the lead is not — the same
  // contract lib/funnels/capture-contact.ts documents. Never log the raw
  // thrown value: a unique-index violation on contacts embeds the literal
  // email address in `details`; `code` and `message` are safe.
  try {
    await enrollIfTriggered({ contactId, source: input.source, metadata: input.metadata, businessId })
  } catch (err) {
    const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
    console.error(`recordContactEvent: enrolment failed for contact ${contactId} (source: ${input.source})`, {
      code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
      message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
    })
  }

  return { contactId, created, merged }
}

// NOT transactional. Supabase REST cannot span statements, so this makes
// several independent round-trips: re-point the loser's timeline rows and
// consent rows, carry over user_id if needed, record the merge audit row,
// delete the loser. If the process dies between the audit insert and the
// delete, the loser row is left undeleted with the audit row already
// recorded. That is the residual window — it is not closed here; it is left
// to Stage 1b, which needs database-level primitives (a plpgsql function) to
// close it for real.
//
// What IS guaranteed: a retry is safe. Before inserting the audit row, this
// checks whether one already exists for this exact (survivor_id, merged_id)
// pair and skips the insert if so, so re-running this function after a crash
// re-merges correctly instead of doubling the audit trail.
//
// Timeline rows AND consent rows are re-pointed BEFORE the delete, and that
// order must not change: both contact_timeline_events.contact_id and
// contact_consents.contact_id cascade on delete (see
// supabase/migrations/00214_lead_engine_timeline.sql and
// 00215_lead_engine_consent.sql), so deleting the loser first would destroy
// its timeline history and — far worse — its dated proof of consent, before
// either could be moved to the survivor. contact_merges.merged_id carries no
// FK (deliberately, so the audit trail survives the loser's row), and
// contact_suppressions is keyed by identifier, not contact_id, so neither is
// at risk here. Those are the only two other tables with a foreign key onto
// contacts(id) as of migrations 00212-00215.
export async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()

  const { data: loser, error: loserError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", mergedId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (loserError) throw loserError

  const { data: survivor, error: survivorError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", survivorId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (survivorError) throw survivorError

  const { error: repointError } = await supabase
    .from("contact_timeline_events")
    .update({ contact_id: survivorId })
    .eq("contact_id", mergedId)
  if (repointError) throw repointError

  const { error: consentRepointError } = await supabase
    .from("contact_consents")
    .update({ contact_id: survivorId })
    .eq("contact_id", mergedId)
  if (consentRepointError) throw consentRepointError

  // "A user always has a contact" only holds if a merge never drops the
  // link. If the survivor is missing it, carry the loser's over. If both
  // have one and they disagree, that is not this function's call to make —
  // leave the survivor's in place and record the conflict for a human.
  if (survivor && loser) {
    const survivorUserId = (survivor as { user_id?: string | null }).user_id ?? null
    const loserUserId = (loser as { user_id?: string | null }).user_id ?? null

    if (!survivorUserId && loserUserId) {
      const { error: userIdError } = await supabase
        .from("contacts")
        .update({ user_id: loserUserId })
        .eq("id", survivorId)
      if (userIdError) throw userIdError
    } else if (survivorUserId && loserUserId && survivorUserId !== loserUserId) {
      const { error: userIdConflictError } = await supabase.from("contact_timeline_events").insert({
        business_id: businessId,
        contact_id: survivorId,
        kind: "user_id_conflict",
        source: "system_merge",
        metadata: { survivor_user_id: survivorUserId, loser_user_id: loserUserId, merged_contact_id: mergedId },
      })
      if (userIdConflictError) throw userIdConflictError
    }
  }

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

  const { error: deleteError } = await supabase
    .from("contacts")
    .delete()
    .eq("id", mergedId)
    .eq("business_id", businessId)
  if (deleteError) throw deleteError
}

/**
 * Resolves a contact id from whichever identifiers a caller has on hand —
 * used by the marketing-exit hooks (payment, booking) to find who to stop
 * emailing. Resolution order: userId, then email (normalised), then phone
 * (normalised) — each is only consulted if the previous one was given but
 * matched nothing. Returns null when nothing matches; that is a legitimate
 * answer (this person has no contact record yet), not an error.
 *
 * Email and phone are normalised through the same functions writes use
 * (normaliseEmail / normalisePhone) before querying: the `contacts` unique
 * index is on `lower(email)` while lookups use a plain `.eq("email", …)`,
 * and they only agree because the value handed to `.eq()` was already
 * normalised. Skipping normalisation here would silently fail to find
 * people whose raw casing/formatting differs from what was stored.
 */
export async function findContactByIdentifiers(args: {
  email?: string | null
  phone?: string | null
  userId?: string | null
  businessId?: string
}): Promise<string | null> {
  const supabase = getClient()
  const businessId = args.businessId ?? SINGLETON_BUSINESS_ID

  if (args.userId) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", args.userId)
      .maybeSingle()
    if (error) throw error
    if (data) return (data as { id: string }).id
  }

  const email = normaliseEmail(args.email)
  if (email) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("email", email)
      .maybeSingle()
    if (error) throw error
    if (data) return (data as { id: string }).id
  }

  const phone = normalisePhone(args.phone)
  if (phone) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("phone_e164", phone)
      .maybeSingle()
    if (error) throw error
    if (data) return (data as { id: string }).id
  }

  return null
}
