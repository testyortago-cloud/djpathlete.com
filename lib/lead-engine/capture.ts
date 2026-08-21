// lib/lead-engine/capture.ts — the shared front door every non-funnel entry
// point uses to join the contact spine. Generalizes the mapping
// lib/funnels/capture-contact.ts pioneered for the funnel submit route: same
// swallow-and-log contract (a contact write failure must never fail the
// caller's own successful write) and the same real-error-shape logging
// discipline — `code`/`message` only, never `details`/`hint`, which can
// embed the submitted email inside a unique-index violation.

import { recordContactEvent, type ContactEventSource } from "@/lib/db/contacts"

// This constant lives in lib/lead-engine, which
// __tests__/lib/lead-engine/no-brand-literals.test.ts sweeps for a
// hard-coded brand name. The newsletter form's checkbox
// (components/public/NewsletterForm.tsx) does carry real legal wording, but
// it names the business directly, so it cannot be reproduced here without
// tripping that sweep — and it is not shown on every path that reaches this
// route anyway: components/marketing/blog/InlinePostNewsletterCapture.tsx
// posts to the same POST /api/newsletter with no checkbox at all, defaulting
// consent_marketing to true unconditionally. The one thing genuinely true of
// every submission this route receives is the act itself — a click on a
// button labelled "Subscribe" — so that is what this constant states,
// matching the design's own framing (the subscribe action IS the consent
// act; wording = the form's subscribe label, rendered server-side).
export const NEWSLETTER_CONSENT_WORDING = "Subscribed via the newsletter form (Subscribe button)"

export type CaptureLeadInput = {
  source: string
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
      source: input.source as ContactEventSource,
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
