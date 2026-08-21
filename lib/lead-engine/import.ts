// lib/lead-engine/import.ts
//
// The DAL half of the GHL contacts import (the script itself,
// `scripts/import-ghl-contacts.mjs`, is a later task; this file is what it
// will call per record). `importGhlContact` resolves identity through the
// EXACT same match/merge core `recordContactEvent` uses
// (`upsertContactIdentity`, `lib/db/contacts.ts`) — existing contacts are
// enriched, never duplicated, and a conflicting identifier is preserved on
// the timeline instead of silently overwritten, same as a live submission.
//
// What makes this an IMPORT and not another contact event: it never calls
// `enrollIfTriggered`. An imported row is history arriving today, not a lead
// that just walked in — enrolling it would fire marketing sequences at
// people who did nothing this minute. That property is load-bearing enough
// that `__tests__/lib/lead-engine/import.test.ts` proves it two ways: a
// direct assertion (`sequence_runs` stays empty even with a matching ACTIVE
// sequence present) and a mutation test (temporarily routing the identity
// call through `recordContactEvent` instead makes that same assertion FAIL).

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { upsertContactIdentity } from "@/lib/db/contacts"
import { suppress, recordConsent } from "@/lib/db/contact-consents"

function getClient() {
  return createServiceRoleClient()
}

// Typed from the REAL export's field shapes
// (ghl-export/2026-08-17T02-41-39/contacts.json, read in full for the first
// two records plus every record with `dnd`/`dndSettings`/`email`/`tags`
// populated — see task-7-report.md). Only the fields this file's logic
// reads are given a narrow type; the rest exist so a caller (the import
// script) can report on them without this file guessing their shape.
export type GhlContactRecord = {
  id: string
  email: string | null
  phone: string | null
  firstName: string | null
  lastName: string | null
  contactName: string | null
  dnd: boolean
  dndSettings: Record<string, { message?: string; status?: string }>
  tags: string[]
  source: string | null
  dateAdded: string
  attributions?: Array<Record<string, unknown>>
  customFields?: Array<{ id: string; value: unknown }>
}

export type ImportOutcome = {
  kind: "created" | "enriched" | "suppressed_only" | "skipped_no_identifier"
  contactId: string | null
  emailConsentImported: boolean
  smsRepermissionCandidate: boolean
}

/**
 * Email-consent evidence allowlist, built by reading the REAL export's
 * `tags.json` in full (91 tags total — see task-7-report.md for the list).
 * A tag only belongs here if it documents that consent wording was shown
 * and agreed to. GHL's `dndSettings` (per-channel opt-out state) is
 * EXPLICITLY NOT evidence either way — its absence means "no opt-out was
 * recorded", not "consent was given"; silence is not consent.
 *
 * None of the 91 real tags clear that bar. They are pipeline, segment, and
 * routing tags — "newsletter", "subscriber", "questionnaire-completed",
 * "purchased", "contact-form", the `program-<uuid>` and `gclid:` tags, tags
 * naming which nurture sequence was sent, tags naming a sport or an age
 * bracket — none of them are an audit trail of a specific consent sentence
 * being shown and accepted. "subscriber" and "newsletter" come closest, but
 * they describe a marketing SEGMENT the contact was placed in, not a
 * consent EVENT documented at the time it happened.
 *
 * The allowlist is therefore empty. That is the correct, stated finding for
 * this snapshot — not a bug to fix by lowering the bar. It means this
 * import records ZERO email consent rows: an email address showing up in
 * the export is not consent to email it. Every phone still imports (per the
 * parent stage's SMS design), just with no SMS consent either — see
 * `smsRepermissionCandidate` below.
 */
export const EMAIL_CONSENT_TAG_ALLOWLIST: string[] = []

/**
 * Pure matcher, exported separately from the allowlist above so the rule
 * itself — "the first allowlisted tag on the record is evidence, citing the
 * literal tag string" — is unit-testable against a synthetic allowlist
 * without touching the real (empty) one `importGhlContact` uses by default.
 */
export function findEmailConsentEvidence(
  tags: string[],
  allowlist: string[] = EMAIL_CONSENT_TAG_ALLOWLIST,
): { ghl_field: string; value: string } | null {
  for (const tag of tags) {
    if (allowlist.includes(tag)) return { ghl_field: "tags", value: tag }
  }
  return null
}

function displayName(record: GhlContactRecord): string | null {
  if (record.contactName) return record.contactName
  const joined = [record.firstName, record.lastName].filter(Boolean).join(" ").trim()
  return joined || null
}

/**
 * Idempotency mechanism for the `ghl_import` provenance row: there is no
 * unique DB constraint on (contact_id, kind, metadata->>'ghl_id') — adding
 * one for a single manual, one-shot script isn't worth a new index — so
 * this reads back the contact's existing `ghl_import` timeline rows and
 * checks whether this GHL id is already cited in one of them before
 * writing. A duplicate read-then-write race is not a concern: the import
 * script this feeds (Task 8) is human-run, single-process, never
 * concurrent with itself.
 */
async function alreadyLoggedImport(contactId: string, ghlId: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_timeline_events")
    .select("metadata")
    .eq("contact_id", contactId)
    .eq("kind", "ghl_import")
  if (error) throw error
  return (data ?? []).some((row: { metadata?: { ghl_id?: unknown } }) => row.metadata?.ghl_id === ghlId)
}

export async function importGhlContact(
  record: GhlContactRecord,
  ctx: { snapshotTimestamp: string },
): Promise<ImportOutcome> {
  const businessId = SINGLETON_BUSINESS_ID
  const email = normaliseEmail(record.email)
  const phone = normalisePhone(record.phone)

  if (!email && !phone) {
    return {
      kind: "skipped_no_identifier",
      contactId: null,
      emailConsentImported: false,
      smsRepermissionCandidate: false,
    }
  }

  // GHL's own do-not-disturb flag is a request to stop contacting this
  // person. It goes straight into `contact_suppressions` (identifier-keyed,
  // survives independently of any contact row) and nowhere else: no
  // contact upsert, no consent row, no timeline event. Suppressing both
  // identifiers the record carries (whichever are present) means a later
  // submission that reuses the same email OR the same phone is blocked
  // too, not just an exact repeat of this record.
  if (record.dnd === true) {
    if (email) await suppress(email, "ghl_dnd_import", businessId)
    if (phone) await suppress(phone, "ghl_dnd_import", businessId)
    return {
      kind: "suppressed_only",
      contactId: null,
      emailConsentImported: false,
      smsRepermissionCandidate: false,
    }
  }

  const { contactId, created, identifierConflicts } = await upsertContactIdentity({
    email,
    phone,
    name: displayName(record),
    businessId,
  })

  const supabase = getClient()

  // Same guarantee `recordContactEvent` gives a live submission: a
  // conflicting identifier from the import is never silently discarded.
  for (const conflict of identifierConflicts) {
    const { error } = await supabase.from("contact_timeline_events").insert({
      business_id: businessId,
      contact_id: contactId,
      kind: "identifier_conflict",
      source: "ghl_import",
      metadata: { field: conflict.field, submitted: conflict.submitted, existing: conflict.existing },
    })
    if (error) {
      console.error(
        `importGhlContact: failed to append identifier_conflict event for contact ${contactId} (field: ${conflict.field})`,
        error,
      )
    }
  }

  let emailConsentImported = false
  const evidence = email ? findEmailConsentEvidence(record.tags ?? []) : null
  if (evidence) {
    await recordConsent({
      contactId,
      channel: "email",
      granted: true,
      source: "ghl_import",
      wordingShown: JSON.stringify({
        ghl_field: evidence.ghl_field,
        value: evidence.value,
        snapshot: ctx.snapshotTimestamp,
      }),
      businessId,
    })
    emailConsentImported = true
  }

  // Every imported phone is a re-permission CANDIDATE, never SMS consent —
  // the parent stage's design is explicit that a GHL phone number carries
  // no SMS consent by itself. Flagging it on the timeline is what lets
  // Task 9's ops script find these contacts later for the actual
  // re-permission ask.
  const smsRepermissionCandidate = Boolean(phone)
  if (smsRepermissionCandidate) {
    const { error } = await supabase.from("contact_timeline_events").insert({
      business_id: businessId,
      contact_id: contactId,
      kind: "sms_repermission_candidate",
      source: "ghl_import",
      metadata: { ghl_id: record.id },
    })
    if (error) {
      console.error(
        `importGhlContact: failed to append sms_repermission_candidate event for contact ${contactId}`,
        error,
      )
    }
  }

  const alreadyLogged = await alreadyLoggedImport(contactId, record.id)
  if (!alreadyLogged) {
    const { error } = await supabase.from("contact_timeline_events").insert({
      business_id: businessId,
      contact_id: contactId,
      kind: "ghl_import",
      source: "ghl_import",
      metadata: { ghl_id: record.id, snapshot: ctx.snapshotTimestamp },
    })
    if (error) {
      console.error(`importGhlContact: failed to append ghl_import event for contact ${contactId}`, error)
    }
  }

  return {
    kind: created ? "created" : "enriched",
    contactId,
    emailConsentImported,
    smsRepermissionCandidate,
  }
}
