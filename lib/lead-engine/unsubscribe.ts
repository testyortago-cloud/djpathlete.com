// lib/lead-engine/unsubscribe.ts — the one revocation flow, shared by the
// two surfaces that can trigger it.
//
// There are two of them because RFC 8058 one-click unsubscribe requires the
// URI in the `List-Unsubscribe` header to accept an HTTPS POST, while the
// link in the email body is followed by a human with a browser and must render
// a page. Next.js App Router will not let a `route.ts` and a `page.tsx` live
// in the same route segment, so the POST endpoint is a sibling route
// (`app/api/unsubscribe/[token]/route.ts`) rather than a second export on the
// page's segment.
//
// Both call THIS function. Two copies of a consent-revocation flow is exactly
// the kind of drift that ends with one surface suppressing an address and the
// other only exiting a run.

import { verifyUnsubscribeToken } from "@/lib/lead-engine/unsubscribe-token"
import { UNSUBSCRIBE_FOOTER_SENTENCE } from "@/lib/lead-engine/email"
import { recordConsent, suppress } from "@/lib/db/contact-consents"
import { exitRunsForContact } from "@/lib/db/sequences"
import { createServiceRoleClient } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit/record"

export type UnsubscribeOutcome =
  | { ok: true; contactId: string; businessId: string }
  | { ok: false; reason: "invalid_token" | "contact_not_found" }

type ContactLookup = { found: true; email: string | null } | { found: false }

async function loadContact(contactId: string, businessId: string): Promise<ContactLookup> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("email")
    .eq("id", contactId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) return { found: false }
  return { found: true, email: (data as { email: string | null }).email }
}

async function recordUnsubscribeTimelineEvent(
  contactId: string,
  businessId: string,
  origin: UnsubscribeOrigin,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "unsubscribed",
    source: origin,
    metadata: {},
  })
  if (error) throw error
}

/**
 * WHICH surface the person used to unsubscribe. Recorded verbatim on the
 * consent row, the timeline row and the audit row, because "they clicked the
 * link in an email" and "they typed their address into the unsubscribe page"
 * are different evidence if a complaint ever has to be answered.
 *
 * `newsletter_form` is the legacy POST /api/newsletter/unsubscribe, which
 * until G07 wrote newsletter_subscribers.unsubscribed_at and nothing else.
 */
export type UnsubscribeOrigin = "unsubscribe_link" | "newsletter_form"

/**
 * The whole revocation for a contact who has asked to stop hearing from us,
 * whichever surface they used. In order:
 *
 *   1. Record the consent revocation (append-only - a repeat visit adding
 *      another "granted: false" row is correct, not a bug).
 *   2. Suppress the email (idempotent: `suppress` swallows the unique-
 *      constraint violation a second insert produces).
 *   3. Exit every active sequence run for the contact.
 *   4. Append a contact_timeline_events row of kind `unsubscribed`.
 *   5. Audit it.
 *
 * 1 and 2 run BEFORE 3 deliberately: if the process dies between steps, the
 * person is left suppressed (safe) rather than merely un-enrolled from one
 * sequence while still opted in everywhere else. Safe to repeat - mail
 * scanners prefetch links, so a second call must not throw.
 *
 * Extracted in G07 so the legacy newsletter route performs the SAME writes as
 * the signed-token flow rather than a second implementation of them. This
 * file's header already named that drift as the thing to avoid; it now has
 * three callers rather than two.
 */
export async function revokeEmailConsentForContact(args: {
  contactId: string
  email: string | null
  businessId: string
  origin: UnsubscribeOrigin
  wordingShown: string
  /**
   * Who asked, when the surface is one where ANYONE can ask on someone
   * else's behalf. The signed-token flow omits both — the token IS the
   * evidence — but the newsletter form is an unauthenticated raw-email
   * POST, and there the IP is the only thing separating a real request
   * from an abusive one after the fact.
   */
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const { contactId, email, businessId, origin, wordingShown } = args

  await recordConsent({
    contactId,
    channel: "email",
    granted: false,
    source: origin,
    wordingShown,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    businessId,
  })

  if (email) {
    await suppress(email, "unsubscribed", businessId)
  }

  await exitRunsForContact(contactId, "unsubscribed", businessId)
  await recordUnsubscribeTimelineEvent(contactId, businessId, origin)

  // Spec 13. Both surfaces are UNAUTHENTICATED public endpoints that revoke
  // consent and suppress an address, so this belongs in the audit trail and
  // not only in contact_timeline_events - whose metadata the retention cron
  // scrubs.
  //
  // The actor is `system` because nobody is signed in. recordAudit swallows
  // its own failures, so this cannot undo a revocation already written.
  //
  // NO EMAIL ADDRESS in the metadata. The contact id answers "who was this",
  // and this branch has already had to fix logs that carried PII.
  await recordAudit({
    action: "marketing.unsubscribed",
    category: "compliance",
    outcome: "success",
    actor: { id: null, email: null, role: "system" },
    target: { type: "contact", id: contactId },
    metadata: {
      business_id: businessId,
      channel: "email",
      source: origin,
      suppressed_identifier: email !== null,
    },
  })
}

/**
 * Performs the whole revocation for a signed unsubscribe token. On a valid
 * token, in order:
 *
 *   1. Record the consent revocation (append-only — a repeat visit adding
 *      another "granted: false" row is correct, not a bug).
 *   2. Suppress the contact's email (idempotent: `suppress` swallows the
 *      unique-constraint violation a second insert produces).
 *   3. Exit every active sequence run for the contact.
 *   4. Append a `contact_timeline_events` row of kind `unsubscribed`.
 *
 * 1 and 2 run BEFORE 3 deliberately: if the process dies between steps, the
 * person is left suppressed (safe) rather than merely un-enrolled from one
 * sequence while still opted in everywhere else. The whole flow is safe to
 * repeat — mail scanners prefetch links, so a second call must not throw.
 *
 * Returns an outcome rather than calling `notFound()` itself: one caller is a
 * React page that renders a 404, the other is a route handler that answers a
 * status code, and only they know which.
 */
export async function processUnsubscribe(token: string): Promise<UnsubscribeOutcome> {
  const verified = verifyUnsubscribeToken(token)
  if (!verified.valid) return { ok: false, reason: "invalid_token" }

  const { contactId, businessId } = verified
  const contact = await loadContact(contactId, businessId)
  if (!contact.found) return { ok: false, reason: "contact_not_found" }

  await revokeEmailConsentForContact({
    contactId,
    email: contact.email,
    businessId,
    origin: "unsubscribe_link",
    wordingShown: UNSUBSCRIBE_FOOTER_SENTENCE,
  })

  return { ok: true, contactId, businessId }
}
