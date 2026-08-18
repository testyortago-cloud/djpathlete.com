import { notFound } from "next/navigation"
import { verifyUnsubscribeToken } from "@/lib/lead-engine/unsubscribe-token"
import { UNSUBSCRIBE_FOOTER_SENTENCE } from "@/lib/lead-engine/email"
import { recordConsent, suppress } from "@/lib/db/contact-consents"
import { exitRunsForContact } from "@/lib/db/sequences"
import { createServiceRoleClient } from "@/lib/supabase"

// This page writes on every render, so it must never be statically cached.
export const dynamic = "force-dynamic"

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
 * The unsubscribe landing page reached from a sequence email's footer link.
 * On a valid token this performs, in order:
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
 * repeat — mail scanners prefetch links, so a second visit must not throw.
 */
export default async function UnsubscribeTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = verifyUnsubscribeToken(token)
  if (!verified.valid) notFound()

  const { contactId, businessId } = verified
  const contact = await loadContact(contactId, businessId)
  if (!contact.found) notFound()

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

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-heading font-semibold text-primary mb-4">Unsubscribed</h1>
        <p className="text-muted-foreground">
          You won&apos;t receive any further emails in this sequence.
        </p>
      </div>
    </div>
  )
}
