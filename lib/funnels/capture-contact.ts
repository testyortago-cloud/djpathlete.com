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
  /**
   * REQUIRED, and deliberately not defaulted. This bridge has no tenant of its
   * own — the submit route resolves one and hands it over. A default here is
   * how a second coach's funnel lead would silently file under the platform.
   */
  businessId: string
  /** G06: the submitter's own IANA zone, stored fill-only by the DAL. */
  timezone?: string | null
  /**
   * G10. Facts the SERVER derived about this submission — today just
   * `role` — as opposed to `payload`, which is whatever the visitor typed.
   *
   * Merged OVER `payload`, deliberately. A funnel field's name is chosen by
   * the owner and validated only as `^[a-z][a-z0-9_]{0,39}$`, so an owner
   * CAN name a field `role`; when one does, what the form declares about
   * itself must win over what a stranger typed into it. Nothing on
   * production names such a field today (checked read-only), so this decides
   * a collision that has not happened yet rather than changing one that has.
   */
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  if (!input.email && !input.phone) return null
  try {
    const { contactId } = await recordContactEvent({
      email: input.email,
      phone: input.phone,
      name: input.name,
      source: "funnel_form",
      attributionSessionId: input.attributionSessionId,
      timezone: input.timezone ?? null,
      metadata: { ...input.payload, ...(input.metadata ?? {}) },
      businessId: input.businessId,
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
