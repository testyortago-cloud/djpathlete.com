// The one entry point every front door calls.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"
import { enrollIfTriggered } from "@/lib/lead-engine/enroll"

export type ContactEventSource =
  | "funnel_form"
  | "funnel_checkout"
  | "contact_form"
  | "newsletter"
  | "lead_magnet"
  | "event_signup"
  | "shop"
  | "assessment"
  | "questionnaire"
  | "step_up"
  | "ai_chat"
  | "inquiry"
  | "purchase"
  // NO MIGRATION NEEDED. `contact_timeline_events.source` is plain
  // `text NOT NULL` with no CHECK constraint (00214_lead_engine_timeline.sql),
  // so this union is the only place the set is enforced.
  | "quiz"

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

export type IdentifierConflict = { field: "email" | "phone"; submitted: string; existing: string }

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

export type UpsertContactIdentityInput = {
  email?: string | null
  phone?: string | null
  name?: string | null
  attributionSessionId?: string | null
  businessId?: string
}

export type UpsertContactIdentityResult = {
  contactId: string
  created: boolean
  merged: boolean
  identifierConflicts: IdentifierConflict[]
}

/**
 * The identity/merge/upsert core every entry point ultimately needs:
 * normalise, find who this might already be (`findMatchCandidates`), decide
 * create/update/merge (`decideMerge`), and write the winning contact row.
 * Extracted out of `recordContactEvent` so a second, non-enrolling caller —
 * the GHL import (`lib/lead-engine/import.ts`, `importGhlContact`) — can
 * reuse the exact same matching and conflict rules without pulling in
 * anything that makes `recordContactEvent` a *contact event*: this function
 * writes no timeline row (the caller decides what happened and how to
 * describe it — "entry_point" for a live submission, "ghl_import" for an
 * import) and never calls `enrollIfTriggered`. `recordContactEvent` below is
 * now a thin wrapper around this plus its own timeline writes and the
 * enrolment attempt — behavior identical to before the extraction, which the
 * existing `recordContactEvent` suites prove by staying green unmodified.
 */
export async function upsertContactIdentity(input: UpsertContactIdentityInput): Promise<UpsertContactIdentityResult> {
  const businessId = input.businessId ?? SINGLETON_BUSINESS_ID
  const email = normaliseEmail(input.email)
  const phone = normalisePhone(input.phone)

  if (!email && !phone) {
    throw new Error("upsertContactIdentity needs at least one usable identifier (email or phone)")
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

  return { contactId, created, merged, identifierConflicts }
}

export async function recordContactEvent(
  input: RecordContactEventInput,
): Promise<{ contactId: string; created: boolean; merged: boolean }> {
  const businessId = input.businessId ?? SINGLETON_BUSINESS_ID

  const { contactId, created, merged, identifierConflicts } = await upsertContactIdentity({
    email: input.email,
    phone: input.phone,
    name: input.name,
    attributionSessionId: input.attributionSessionId,
    businessId,
  })

  const supabase = getClient()

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

// Runs in a single transaction inside the `merge_contacts` plpgsql function
// (supabase/migrations/00217_lead_engine_sequence_functions.sql) — Supabase
// REST cannot span statements, so this used to be several independent
// round-trips with a real crash window between the audit insert and the
// loser's delete. That window is closed: re-pointing every child, the
// user_id carry-over, the idempotent audit insert, and the final delete all
// commit or roll back together now.
//
// The list of child tables the function re-points before deleting the loser
// — currently five: contact_timeline_events, contact_consents,
// sequence_messages, sequence_runs, and contact_merges.survivor_id — lives
// in that migration file, not here. It must be updated there whenever a new
// table gains a foreign key onto contacts(id), or that table's rows for the
// loser are destroyed by cascade instead of being carried to the survivor.
// This is not hypothetical: Stage 1a's merge missed contact_consents and
// destroyed consent evidence, and this function's own first draft missed a
// fifth child, contact_merges.survivor_id.
export async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()
  const { error } = await supabase.rpc("merge_contacts", {
    p_survivor: survivorId,
    p_merged: mergedId,
    p_business: businessId,
    p_reason: "email and phone resolved to different contacts",
  })
  if (error) throw error
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

/**
 * DELIBERATELY UNSCOPED -- the only contact lookup in this repo with no
 * business predicate, and it must stay that way. Its caller is a vendor
 * webhook (one Stripe account serves every business) which has NO tenant in
 * scope; the contact row it finds is what SUPPLIES the tenant to every
 * consequence downstream. Do not "fix" this by adding a businessId: a
 * businessId here would have to be a guess, and the guess is the leak.
 *
 * KNOWN AMBIGUITY, stated rather than hidden: two businesses can each hold a
 * contact with the same email -- a shared lead. Resolution is the OLDEST row
 * (the first business to know this person) plus a warning, which is
 * deterministic but not RIGHT. The right fix is stamping business_id into the
 * Stripe checkout session metadata at creation and preferring it when
 * present; that touches every checkout creation site and is phase 4.
 */
export async function findContactWithBusinessByIdentifiers(args: {
  email?: string | null
  userId?: string | null
}): Promise<{ id: string; businessId: string } | null> {
  const supabase = getClient()

  const pick = async (column: "user_id" | "email", value: string) => {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, business_id, created_at")
      .eq(column, value)
      .order("created_at", { ascending: true })
    if (error) throw error
    const rows = (data ?? []) as { id: string; business_id: string }[]
    if (rows.length === 0) return null
    if (rows.length > 1) {
      console.warn(
        `[contacts] ${rows.length} contacts across businesses match ${column}; taking the oldest (${rows[0].business_id}). ` +
          `Stamp business_id into the checkout session to remove this ambiguity.`,
      )
    }
    return { id: rows[0].id, businessId: rows[0].business_id }
  }

  if (args.userId) {
    const hit = await pick("user_id", args.userId)
    if (hit) return hit
  }
  const email = normaliseEmail(args.email)
  if (email) {
    const hit = await pick("email", email)
    if (hit) return hit
  }
  return null
}
