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
//
// First-touch attribution (spec §7): 246 of the real export's 300 records
// carry a non-empty `attributions` array. Rather than fabricate first-touch
// fields this import has no columns for, the record's raw `attributions`
// blob rides along verbatim in the `ghl_import` timeline event's own
// metadata — metadata is this file's whole provenance bag already (ghl_id,
// snapshot, date_added), so attribution evidence belongs there too, capped
// defensively at 4000 serialized characters (`buildAttributionsMetadata`
// below) since nothing about the export's own shape bounds that array's
// size.
//
// `ctx.businessId` is REQUIRED, not defaulted — this file used to resolve
// `SINGLETON_BUSINESS_ID` internally, which is exactly how a second-business
// import would silently write every record into the platform's own tenant.
// The one caller today (scripts/import-ghl-contacts.ts) supplies
// `SINGLETON_BUSINESS_ID` explicitly, because this one-time GHL migration
// really does target only the platform's own historical data — that is a
// property of the script, not something this DAL function should assume.

import { createServiceRoleClient } from "@/lib/supabase"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { upsertContactIdentity } from "@/lib/db/contacts"
import { suppress, recordConsent, isSuppressed } from "@/lib/db/contact-consents"

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
  // Only present when the identity/merge core actually ran (i.e. not on
  // skipped_no_identifier or suppressed_only, which never reach
  // upsertContactIdentity). Threaded straight from its `merged` result so a
  // caller — Task 8's dry-run/execute reporting — can count how many
  // imported records triggered a destructive contact merge, a fact the
  // three-way kind enum alone can't distinguish (a merge still reports
  // "enriched"). Additive: existing outcomes that never set it are
  // unaffected by callers that don't read it.
  merged?: boolean
}

/**
 * Email-consent evidence allowlist, built by reading the REAL export's
 * `tags.json` in full (104 tags total, confirmed against MANIFEST.json's
 * own count — see task-7-report.md for the list). A tag only belongs here
 * if it documents that consent wording was shown and agreed to. GHL's
 * `dndSettings` (per-channel opt-out state) is EXPLICITLY NOT evidence
 * either way — its absence means "no opt-out was recorded", not "consent
 * was given"; silence is not consent.
 *
 * None of the 104 real tags clear that bar, and the decisive fact is
 * structural, not judgment: every one of the 104 rows has `description:
 * null` AND `categoryId: null` — GHL never captured what any tag MEANS.
 * The spec's own condition for a tag to count as evidence ("a tag whose
 * meaning the MANIFEST/tags.json documents") is therefore unmeetable by
 * construction against this export — there is no meaning recorded for any
 * tag to document, so no tag can satisfy the rule no matter how consent-y
 * its name reads. (Names alone came closest with "newsletter" and
 * "subscriber", but those describe a marketing SEGMENT the contact was
 * placed in, not a consent EVENT documented at the time it happened — and
 * per the structural fact above, GHL recorded no documentation for either
 * one anyway.)
 *
 * The allowlist is therefore empty. That is the correct, stated finding for
 * this snapshot — not a bug to fix by lowering the bar. It means this
 * import records ZERO email consent rows: an email address showing up in
 * the export is not consent to email it. Every phone still imports (per the
 * parent stage's SMS design), just with no SMS consent either — see
 * `smsRepermissionCandidate` below.
 *
 * `readonly` deliberately: nothing in this file — or a caller — should ever
 * mutate the shipped default. A test that needs a non-empty allowlist to
 * exercise the positive-evidence path passes its own array through
 * `ctx.emailConsentTagAllowlist` instead (see `importGhlContact`).
 */
export const EMAIL_CONSENT_TAG_ALLOWLIST: readonly string[] = []

/**
 * Pure matcher, exported separately from the allowlist above so the rule
 * itself — "the first allowlisted tag on the record is evidence, citing the
 * literal tag string" — is unit-testable against a synthetic allowlist
 * without touching the real (empty) one `importGhlContact` uses by default.
 */
export function findEmailConsentEvidence(
  tags: string[],
  allowlist: readonly string[] = EMAIL_CONSENT_TAG_ALLOWLIST,
): { ghl_field: string; value: string } | null {
  for (const tag of tags) {
    if (allowlist.includes(tag)) return { ghl_field: "tags", value: tag }
  }
  return null
}

export type GhlRecordClassification = {
  wouldBe: "skipped_no_identifier" | "dnd_suppression" | "importable"
  hasPhone: boolean
  consentEvidence: boolean
}

/**
 * The pure half of `importGhlContact`'s decision: same branch order (no
 * identifier -> dnd -> everything else), off the same normalisers and the
 * same `findEmailConsentEvidence` rule — but it never reads or writes
 * anything. `importGhlContact` calls this directly for its own branching
 * (below), so the two can never drift: a script that classifies a record as
 * "importable" is guaranteed to see `importGhlContact` attempt exactly that
 * record, because it is the same code deciding both.
 *
 * That guarantee has a hard edge, and it is deliberate: "importable" is not
 * "will report created" or "will report enriched". Those (and whether a
 * merge happens) depend on what's already in the `contacts` table for this
 * business — state a pure, DB-free classifier cannot see. A caller that
 * wants outcome-class counts without a DB client (Task 8's dry-run) gets
 * importable/dnd/skipped counts, not created/enriched counts; the latter
 * are only knowable once `importGhlContact` actually runs.
 */
export function classifyGhlRecord(
  record: GhlContactRecord,
  allowlist: readonly string[] = EMAIL_CONSENT_TAG_ALLOWLIST,
): GhlRecordClassification {
  const email = normaliseEmail(record.email)
  const phone = normalisePhone(record.phone)

  if (!email && !phone) {
    return { wouldBe: "skipped_no_identifier", hasPhone: false, consentEvidence: false }
  }

  if (record.dnd === true) {
    return { wouldBe: "dnd_suppression", hasPhone: Boolean(phone), consentEvidence: false }
  }

  const evidence = email ? findEmailConsentEvidence(record.tags ?? [], allowlist) : null
  return { wouldBe: "importable", hasPhone: Boolean(phone), consentEvidence: Boolean(evidence) }
}

// The `ghl_import` timeline event's own metadata bag is where the record's
// raw `attributions` array (when the export carries one) lands — see the
// header comment's "First-touch attribution" paragraph. 4000 serialized
// characters is a defensive ceiling, not a real-world limit: the largest
// `attributions` array across the actual export is ~1150 characters
// serialized, so this branch is untested against real data by construction
// and exists purely so a future, much larger export can't blow up a single
// timeline row's metadata column.
const ATTRIBUTIONS_METADATA_CAP_CHARS = 4000

/**
 * Pure, exported separately so the truncation rule is unit-testable without
 * a database — same reasoning as `findEmailConsentEvidence` above.
 *
 * Returns `{}` (no `attributions` key at all, not `attributions: undefined`)
 * when the record carries none, so spreading the result into the timeline
 * event's metadata omits the key entirely rather than writing a null/empty
 * placeholder — "this record had no attribution evidence" and "this record
 * had attribution evidence we chose not to store" must stay distinguishable
 * later, and only the former should ever produce a bare metadata object.
 *
 * When the full array already fits, it rides along untouched. When it
 * doesn't, entries are kept from the front (GHL orders `isFirst` before
 * `isLast` in practice, and the first-touch entry is the one spec §7 cares
 * about) one at a time until the next one would push the serialized size
 * over the cap, and `attributions_truncated: true` is stamped so a reader
 * can tell the array was cut rather than assume it's complete.
 */
export function buildAttributionsMetadata(
  attributions: Array<Record<string, unknown>> | undefined,
): { attributions: Array<Record<string, unknown>>; attributions_truncated?: true } | Record<string, never> {
  if (!attributions || attributions.length === 0) return {}

  if (JSON.stringify(attributions).length <= ATTRIBUTIONS_METADATA_CAP_CHARS) {
    return { attributions }
  }

  const kept: Array<Record<string, unknown>> = []
  for (const entry of attributions) {
    const candidate = [...kept, entry]
    if (JSON.stringify(candidate).length > ATTRIBUTIONS_METADATA_CAP_CHARS) break
    kept.push(entry)
  }
  return { attributions: kept, attributions_truncated: true }
}

function displayName(record: GhlContactRecord): string | null {
  if (record.contactName) return record.contactName
  const joined = [record.firstName, record.lastName].filter(Boolean).join(" ").trim()
  return joined || null
}

/**
 * Idempotency mechanism for the WHOLE record, not just the `ghl_import` row:
 * there is no unique DB constraint on (contact_id, kind,
 * metadata->>'ghl_id') — adding one for a single manual, one-shot script
 * isn't worth a new index — so this reads back the contact's existing
 * `ghl_import` timeline rows and checks whether this GHL id is already
 * cited in one of them before doing ANY of this record's writes. A
 * duplicate read-then-write race is not a concern: the import script this
 * feeds (Task 8) is human-run, single-process, never concurrent with
 * itself.
 */
async function alreadyLoggedImport(contactId: string, ghlId: string, businessId: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_timeline_events")
    .select("metadata")
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
    .eq("kind", "ghl_import")
  if (error) throw error
  return (data ?? []).some((row: { metadata?: { ghl_id?: unknown } }) => row.metadata?.ghl_id === ghlId)
}

export async function importGhlContact(
  record: GhlContactRecord,
  ctx: { snapshotTimestamp: string; businessId: string; emailConsentTagAllowlist?: readonly string[] },
): Promise<ImportOutcome> {
  const businessId = ctx.businessId
  const email = normaliseEmail(record.email)
  const phone = normalisePhone(record.phone)

  // The two early branches below (no identifier, dnd) are decided by
  // `classifyGhlRecord` — the exact same function a DB-free dry-run uses to
  // predict them — so the "what will this record do" answer can never
  // diverge between the two call sites.
  const classification = classifyGhlRecord(record, ctx.emailConsentTagAllowlist)

  if (classification.wouldBe === "skipped_no_identifier") {
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
  if (classification.wouldBe === "dnd_suppression") {
    if (email) await suppress(email, "ghl_dnd_import", businessId)
    if (phone) await suppress(phone, "ghl_dnd_import", businessId)
    return {
      kind: "suppressed_only",
      contactId: null,
      emailConsentImported: false,
      smsRepermissionCandidate: false,
    }
  }

  const { contactId, created, merged, identifierConflicts } = await upsertContactIdentity({
    email,
    phone,
    name: displayName(record),
    businessId,
  })

  const supabase = getClient()

  // Idempotency for the WHOLE record lives here, above every write below:
  // if this ghl id is already cited on this contact's ghl_import history,
  // every write this function could make (identifier_conflict, consent,
  // sms_repermission_candidate, ghl_import) was already made by an earlier
  // run — re-running is then a pure read plus this early return, not a
  // second copy of each row. Per-write dedup (checking each kind
  // separately) was the earlier design and left three of the four write
  // kinds duplicating on every re-run; this makes the record atomic instead.
  const alreadyLogged = await alreadyLoggedImport(contactId, record.id, businessId)
  if (alreadyLogged) {
    return {
      kind: "enriched",
      contactId,
      emailConsentImported: false,
      smsRepermissionCandidate: Boolean(phone),
      merged,
    }
  }

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
  const evidence = email ? findEmailConsentEvidence(record.tags ?? [], ctx.emailConsentTagAllowlist) : null
  if (evidence) {
    // Defence in depth: evidence is unreachable against the shipped (empty)
    // allowlist today, but if it is ever populated, a contact already in
    // contact_suppressions must not gain a fresh "granted: true" consent
    // row out from under that suppression — "existing suppressions always
    // win" (spec §7) applies to writes THIS function makes, not just to
    // reads elsewhere.
    const suppressed = await isSuppressed(email as string, businessId)
    if (suppressed) {
      console.warn(
        `importGhlContact: skipping email consent import for contact ${contactId} — ${email} is already suppressed, and existing suppressions always win`,
      )
    } else {
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

  const { error: ghlImportError } = await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "ghl_import",
    source: "ghl_import",
    metadata: {
      ghl_id: record.id,
      snapshot: ctx.snapshotTimestamp,
      date_added: record.dateAdded,
      ...buildAttributionsMetadata(record.attributions),
    },
  })
  if (ghlImportError) {
    console.error(`importGhlContact: failed to append ghl_import event for contact ${contactId}`, ghlImportError)
  }

  return {
    kind: created ? "created" : "enriched",
    contactId,
    emailConsentImported,
    smsRepermissionCandidate,
    merged,
  }
}
