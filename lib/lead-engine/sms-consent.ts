// lib/lead-engine/sms-consent.ts — a contact taps a signed link and tells us,
// in their own explicit act, that we may text them.
//
// This closes the loop migration 00223 left open on purpose. That migration's
// header explains at length why its re-permission email asks people to REPLY
// YES rather than tap a link: no consent landing page existed, and inventing a
// URL for a page that does not exist would have shipped a dead link to ~73
// real people. Its "FUTURE WORK" paragraph describes this file. Recording a
// YES is a manual act today; after this, tapping the link is not.
//
// ---------------------------------------------------------------------------
// THE ONE DIFFERENCE FROM lib/lead-engine/unsubscribe.ts, AND WHY IT MATTERS
// ---------------------------------------------------------------------------
// `processUnsubscribe` runs on the GET that renders the unsubscribe page. This
// module must NEVER be driven by a GET, and the split below (`readSmsConsent
// State` reads, `confirmSmsConsent` writes) is that rule made structural.
//
// lib/lead-engine/email.ts (~lines 157-165) already records the hazard for the
// unsubscribe page: corporate mail scanners — Safe Links, Mimecast, Barracuda
// — GET every URL in an inbound message before a human sees it. For a
// revocation link the cost of that is a person unsubscribed who did not ask to
// be; unwanted, but it errs toward leaving people alone. Here the same
// prefetch would run the other way and FABRICATE CONSENT: a `contact_consents`
// row asserting that somebody agreed to be texted, created by a robot in their
// employer's mail gateway, and produced as the evidence when a carrier or a
// regulator asks why this business texted them. The consent record exists
// precisely to make that claim checkable; a record a scanner can manufacture
// is worth less than no record at all.
//
// So: the page GETs `readSmsConsentState`, which only reads. The consent row
// is written by `confirmSmsConsent`, reached solely from the POST behind the
// "I agree" button. __tests__/app/sms-consent-page.test.ts asserts a GET —
// repeated, and with a `?done=1` query string appended — writes nothing at
// all.
//
// ---------------------------------------------------------------------------
// A PRIOR "STOP" IS NOT UNDONE FROM HERE
// ---------------------------------------------------------------------------
// If the contact's phone sits in `contact_suppressions`, they texted STOP at
// some point, and that arrived through app/api/webhooks/twilio/inbound/
// route.ts — an SMS from the handset itself, signature-checked against
// TWILIO_AUTH_TOKEN. A link tapped in an email is a weaker signal than a
// message sent from the phone in question, so it does not get to overrule it,
// and `loadRunContext` (lib/db/sequences.ts) would go on suppressing the run
// regardless of any consent row written here. Telling somebody "you're all
// set" while they stay blocked would be a straight lie. This returns a
// distinct outcome instead, and the page says: text START.

import { verifySmsConsentToken } from "@/lib/lead-engine/sms-consent-token"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { hasConsent, isSuppressed, recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { createServiceRoleClient } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit/record"

/** `contact_consents.source` and `contact_timeline_events.source` for this flow. */
export const SMS_CONSENT_SOURCE = "sms_consent_link"

/** `contact_timeline_events.kind` for a confirmed consent. */
export const SMS_CONSENT_TIMELINE_KIND = "sms_consent_confirmed"

/**
 * Everything the page can be looking at, and everything the write can decide.
 * ONE union, resolved by ONE function, so the two can never disagree about
 * which situation a given token is in — a page that renders an "I agree"
 * button the write would refuse is the mismatch this shape rules out.
 */
export type SmsConsentState =
  | { state: "invalid_token" }
  | { state: "contact_not_found" }
  | { state: "phone_suppressed"; contactId: string; businessId: string }
  | { state: "already_consented"; contactId: string; businessId: string }
  | { state: "wording_unavailable"; contactId: string; businessId: string }
  | { state: "ask"; contactId: string; businessId: string; wording: string }

export type SmsConsentOutcome =
  | { ok: true; contactId: string; businessId: string; wording: string }
  | {
      ok: false
      reason: "invalid_token" | "contact_not_found" | "phone_suppressed" | "already_consented" | "wording_unavailable"
    }

type ContactLookup = { found: true; phone: string | null } | { found: false }

async function loadContact(contactId: string, businessId: string): Promise<ContactLookup> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("phone_e164")
    // BOTH keys. A token carries the business id as well as the contact id,
    // and looking up by contact id alone would let a token signed for one
    // business reach another's contact row.
    .eq("id", contactId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) return { found: false }
  return { found: true, phone: (data as { phone_e164: string | null }).phone_e164 }
}

async function recordSmsConsentTimelineEvent(contactId: string, businessId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: SMS_CONSENT_TIMELINE_KIND,
    source: SMS_CONSENT_SOURCE,
    metadata: {},
  })
  if (error) throw error
}

/**
 * Reads — and only reads — what this token is currently good for.
 *
 * Safe to call from a GET, and called from exactly one: the page render. Every
 * branch here is a `select`; there is no write path in this function and there
 * must never be one.
 *
 * The order of the checks is deliberate:
 *
 *   1. suppression, BEFORE consent. A contact who agreed and later texted STOP
 *      has both a granted consent row and a suppression row, and the honest
 *      answer to them is the STOP one.
 *   2. existing consent, BEFORE the wording. Somebody who already said yes
 *      does not need to be asked again, and does not need the sentence.
 *   3. the wording last, because it is the only step that can fail on
 *      configuration rather than on the contact.
 */
export async function readSmsConsentState(token: string): Promise<SmsConsentState> {
  const verified = verifySmsConsentToken(token)
  if (!verified.valid) return { state: "invalid_token" }

  const { contactId, businessId } = verified
  const contact = await loadContact(contactId, businessId)
  if (!contact.found) return { state: "contact_not_found" }

  // No phone on file is not a blocker. Suppression is keyed by identifier, so
  // there is nothing to check, and consent is keyed by CONTACT — someone who
  // agrees before a number is on file has still agreed.
  if (contact.phone && (await isSuppressed(contact.phone, businessId))) {
    return { state: "phone_suppressed", contactId, businessId }
  }

  if (await hasConsent(contactId, "sms")) {
    return { state: "already_consented", contactId, businessId }
  }

  const settings = await getBusinessSettings(businessId)
  if (!hasSmsConsentDisplayName(settings.display_name)) {
    // Same gate the funnel form island and the funnel submit route already
    // share (see `hasSmsConsentDisplayName`'s own doc comment):
    // `business_settings.display_name` is seeded `''`, and a consent sentence
    // that cannot name who is texting is not consent to anything. Refusing
    // here means no button is shown AND no row is filed — one verdict, both
    // sides.
    return { state: "wording_unavailable", contactId, businessId }
  }

  return { state: "ask", contactId, businessId, wording: renderSmsConsentWording(settings.display_name) }
}

/**
 * Performs the whole grant for a signed token, after an explicit press of the
 * "I agree" button. In order: resolve the state, record the consent row,
 * append a timeline event, write the audit row.
 *
 * NEVER call this from a GET. See the header.
 *
 * IDEMPOTENT BY REFUSAL, not by append. `processUnsubscribe` treats a repeat
 * visit as a legitimate second append-only revocation record, and for a
 * revocation that is right — each one is a person saying "stop" again. A
 * repeat here is different: every row is legal evidence of an AGREEMENT, and a
 * double tap, a back-button resubmit or a retried request did not produce two
 * agreements. `already_consented` is therefore refused rather than recorded,
 * and the page shows the same confirmation either way, so a second press
 * neither throws nor duplicates.
 *
 * The wording is re-derived HERE, from `business_settings`, rather than being
 * accepted from the form — the same rule `recordFunnelSmsConsent` follows in
 * app/api/funnels/submit/route.ts. A client cannot be trusted to relay what it
 * actually rendered, and `contact_consents.wording_shown` is a claim about
 * what the person SAW. Deriving both the shown sentence and the filed sentence
 * from one function of one column is what makes that claim provable.
 *
 * Returns an outcome rather than calling `notFound()` or redirecting itself:
 * the caller is a server action that knows where to send the reader, and this
 * module should stay callable from a script or a test without a request.
 */
export async function confirmSmsConsent(
  token: string,
  evidence: { ip?: string | null; userAgent?: string | null } = {},
): Promise<SmsConsentOutcome> {
  const resolved = await readSmsConsentState(token)

  if (resolved.state !== "ask") {
    return { ok: false, reason: resolved.state }
  }

  const { contactId, businessId, wording } = resolved

  await recordConsent({
    contactId,
    channel: "sms",
    granted: true,
    source: SMS_CONSENT_SOURCE,
    wordingShown: wording,
    ip: evidence.ip ?? null,
    userAgent: evidence.userAgent ?? null,
    businessId,
  })

  await recordSmsConsentTimelineEvent(contactId, businessId)

  // An UNAUTHENTICATED public URL just GRANTED permission to text somebody.
  // That direction is the one a carrier or a regulator asks about, so it
  // belongs in the audit trail and not only in `contact_timeline_events`,
  // whose metadata the retention cron scrubs.
  //
  // The actor is `system` because nobody is signed in: the signed token plus
  // the button press is the authorisation. recordAudit swallows its own
  // failures, so this cannot undo a consent row already written.
  //
  // NO EMAIL ADDRESS AND NO PHONE NUMBER in the metadata — the same rule
  // `processUnsubscribe` follows. The contact id answers "who was this". The
  // wording IS included: it names the business, not the person, and the
  // taxonomy entry for this slug promises the trail can answer "to what
  // wording" on its own.
  await recordAudit({
    action: "marketing.sms_consent_confirmed",
    category: "compliance",
    outcome: "success",
    actor: { id: null, email: null, role: "system" },
    target: { type: "contact", id: contactId },
    metadata: {
      business_id: businessId,
      channel: "sms",
      granted: true,
      source: SMS_CONSENT_SOURCE,
      wording_shown: wording,
      ip: evidence.ip ?? null,
    },
  })

  return { ok: true, contactId, businessId, wording }
}
