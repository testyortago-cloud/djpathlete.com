// lib/lead-engine/chat/consent-wording.ts — the two sentences a chat visitor
// agrees to on the details card the assistant puts on screen.
//
// Modelled directly on lib/lead-engine/sms-consent-wording.ts, and for the
// identical reasons:
//
//   STANDALONE SENTENCES. Each one is a whole sentence in this file, not a
//   fragment glued to a shared prefix. A consent line reads to a visitor as one
//   sentence, so it is owned as one — and the two lines below must be able to
//   change independently, because asking to be contacted about a question and
//   opting into marketing email are two different agreements.
//
//   `displayName` IS A PARAMETER, never a constant. This file lives under
//   `lib/lead-engine`, which __tests__/lib/lead-engine/no-brand-literals.test.ts
//   sweeps for a hard-coded brand name — comments included — so there is
//   nowhere for one to hide. Business identity arrives from
//   `getBusinessSettings()`.
//
//   TWO CALLERS THAT MUST AGREE. The card renderer shows these to the visitor
//   before they tick anything, and POST /api/ask/capture re-renders them
//   server-side to file as `contact_consents.wording_shown` — evidence of what
//   was actually shown, never the client's copy of it and never a sentence
//   reconstructed later. Same function, same input, same output.

/** Shown beside the details form itself. The visitor is asking to be contacted about their own question. */
export function renderChatContactWording(displayName: string): string {
  return `I'm asking ${displayName} to get in touch with me about my question.`
}

/** Shown beside the optional tick. A SEPARATE agreement: marketing email, which the first sentence does not cover. */
export function renderChatMarketingWording(displayName: string): string {
  return `I'd also like ${displayName} to email me about coaching, camps and clinics. I can unsubscribe at any time.`
}

/**
 * True only when `displayName` actually names a business — non-blank once
 * whitespace is trimmed.
 *
 * `business_settings.display_name` is seeded `''` (migration 00212 — NOT NULL
 * DEFAULT `''`). That is the state of any install nobody has configured yet,
 * including production and the dev clone today. Feeding it straight into the
 * templates above produces "I'd also like  to email me about coaching" — a
 * sentence that cannot name who is emailing is not consent to anything.
 *
 * THIS IS THE SINGLE GATE BOTH SIDES CHECK. The card renderer asks it before
 * rendering the marketing tick at all, and the capture route asks it again
 * before filing a consent row. Because it is one function, "blank" and "the
 * settings read failed" collapse to the same verdict everywhere, and the
 * sentence shown can never disagree with the sentence filed — a tick rendered
 * from one verdict and a row filed from the other is exactly the mismatch this
 * exists to rule out.
 */
export function hasChatConsentDisplayName(displayName: string | null | undefined): displayName is string {
  return Boolean(displayName?.trim())
}
