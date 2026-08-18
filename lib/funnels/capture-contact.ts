// Bridges a funnel submission into the contact spine.
//
// Deliberately swallows every error. Migrations and deploys race each other, so
// during one deploy window `contacts` may not exist. Losing the contact row is
// recoverable; losing the lead is not.
//
// Deliberately does NOT call recordConsent (lib/db/contact-consents.ts).
// contact_consents.wording_shown is NOT NULL because a consent record must be
// able to reproduce the exact wording the person agreed to, and the funnel
// form does not yet display any consent wording — that checkbox arrives in a
// later stage. Writing a consent row now would mean inventing the wording it
// claims to quote.

import { recordContactEvent } from "@/lib/db/contacts"

export async function captureContactFromSubmission(input: {
  name: string | null
  email: string | null
  phone: string | null
  attributionSessionId: string | null
  payload: Record<string, unknown>
}): Promise<string | null> {
  if (!input.email && !input.phone) return null
  try {
    const { contactId } = await recordContactEvent({
      email: input.email,
      phone: input.phone,
      name: input.name,
      source: "funnel_form",
      attributionSessionId: input.attributionSessionId,
      metadata: input.payload,
    })
    return contactId
  } catch (err) {
    console.error("[capture-contact] contact write failed; submission unaffected", err)
    return null
  }
}
