// lib/lead-engine/capture.ts — the shared front door every non-funnel entry
// point uses to join the contact spine. Generalizes the mapping
// lib/funnels/capture-contact.ts pioneered for the funnel submit route: same
// swallow-and-log contract (a contact write failure must never fail the
// caller's own successful write) and the same real-error-shape logging
// discipline — `code`/`message` only, never `details`/`hint`, which can
// embed the submitted email inside a unique-index violation.

import { recordContactEvent, type ContactEventSource } from "@/lib/db/contacts"

// POST /api/newsletter has two entry points that do not show the visitor
// the same thing: components/public/NewsletterForm.tsx has a required
// checkbox carrying real legal wording naming the business, while
// components/marketing/blog/InlinePostNewsletterCapture.tsx shows no
// checkbox at all and posts consent_marketing: true unconditionally. The
// route tells them apart via the `consent_context` field ("checkbox" |
// "inline") and quotes each honestly:
//
//   - "checkbox" renders lib/lead-engine/newsletter-consent-wording.ts's
//     `renderNewsletterConsentWording(displayName)` against the business's
//     actual configured name — the real thing that surface showed.
//   - "inline", an absent/unrecognized consent_context, AND "checkbox" when
//     no business name is configured (so the template above has nothing to
//     fill it with) all fall back to THIS constant: a generic description
//     of the act itself, never a fabricated or nameless legal sentence.
//
// This constant lives in lib/lead-engine, which
// __tests__/lib/lead-engine/no-brand-literals.test.ts sweeps for a
// hard-coded brand name — it deliberately names no business, which is why
// it can serve as the fallback for both surfaces.
export const NEWSLETTER_CONSENT_WORDING = "Subscribed via the newsletter form (Subscribe button)"

export type CaptureLeadInput = {
  source: ContactEventSource
  email?: string | null
  phone?: string | null
  name?: string | null
  attribution?: {
    gclid?: string | null
    gbraid?: string | null
    wbraid?: string | null
    fbclid?: string | null
  } | null
  metadata?: Record<string, unknown>
}

/**
 * Records `input` on the contact spine and returns the contact id, or
 * `null` when there is nothing to record — no identifier was submitted, or
 * the write itself failed. Never throws: a spine failure must never turn a
 * caller's otherwise-successful request into an error response, so every
 * failure is logged and swallowed here instead of propagated.
 *
 * `RecordContactEventInput` (lib/db/contacts.ts) has no field shaped like
 * `attribution` — gclid/gbraid/wbraid/fbclid only ever reach the contact
 * record through `metadata`, the one arbitrary bag `enrollIfTriggered`'s
 * `trigger_filter` matching also reads from. So attribution, when present,
 * is merged into metadata rather than dropped.
 */
export async function captureLead(input: CaptureLeadInput): Promise<string | null> {
  if (!input.email && !input.phone) return null

  try {
    const { contactId } = await recordContactEvent({
      email: input.email,
      phone: input.phone,
      name: input.name,
      source: input.source,
      metadata: { ...(input.metadata ?? {}), ...(input.attribution ?? {}) },
    })
    return contactId
  } catch (err) {
    // Never log the raw thrown value: a unique-index violation on contacts
    // is a Postgres error whose `details` embeds the literal submitted
    // email address. `code` and `message` are safe; `details`/`hint` are
    // deliberately omitted — same contract as lib/funnels/capture-contact.ts.
    const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
    console.error("[capture-lead] contact write failed; caller unaffected", {
      code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
      message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
      source: input.source,
    })
    return null
  }
}
