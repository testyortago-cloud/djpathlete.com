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

async function recordUnsubscribeTimelineEvent(contactId: string, businessId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "unsubscribed",
    source: "unsubscribe_link",
    metadata: {},
  })
  if (error) throw error
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

  await recordConsent({
    contactId,
    channel: "email",
    granted: false,
    source: "unsubscribe_link",
    wordingShown: UNSUBSCRIBE_FOOTER_SENTENCE,
    businessId,
  })

  if (contact.email) {
    await suppress(contact.email, "unsubscribed", businessId)
  }

  await exitRunsForContact(contactId, "unsubscribed")
  await recordUnsubscribeTimelineEvent(contactId, businessId)

  // Spec §13. This is an UNAUTHENTICATED public URL that revokes consent and
  // suppresses an address, so it belongs in the audit trail and not only in
  // `contact_timeline_events` — whose metadata the retention cron scrubs.
  //
  // The actor is `system` because nobody is signed in: the signed token is the
  // authorisation. recordAudit swallows its own failures, so this cannot undo
  // a revocation that has already been written.
  //
  // NO EMAIL ADDRESS in the metadata. The contact id is enough to answer "who
  // was this", and the branch has already had to fix logs that carried PII.
  await recordAudit({
    action: "marketing.unsubscribed",
    category: "compliance",
    outcome: "success",
    actor: { id: null, email: null, role: "system" },
    target: { type: "contact", id: contactId },
    metadata: {
      business_id: businessId,
      channel: "email",
      source: "unsubscribe_link",
      suppressed_identifier: contact.email !== null,
    },
  })

  return { ok: true, contactId, businessId }
}
