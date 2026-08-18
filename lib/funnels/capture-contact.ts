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
  funnelId?: string | null
  stepId?: string | null
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
    // Never log the raw thrown value: a unique-index violation on
    // contacts_business_email_uniq is a Postgres error whose `details` embeds
    // the literal email address ("Key (business_id, lower(email))=(...,
    // someone@example.com) already exists."). `code` and `message` are safe —
    // `details`/`hint` are the fields that carry the identifier and are
    // deliberately omitted. lib/audit/scrub.ts was considered and doesn't fit:
    // it redacts by KEY name (password/token/secret/api_key), not by scanning
    // string VALUES for PII, so it would let an email inside `details` through
    // untouched. Correlating ids are included so a one-off failure (e.g. a
    // double-click) can still be traced without the PII.
    const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
    console.error("[capture-contact] contact write failed; submission unaffected", {
      code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
      message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
      attributionSessionId: input.attributionSessionId,
      funnelId: input.funnelId ?? null,
      stepId: input.stepId ?? null,
    })
    return null
  }
}
