// lib/lead-engine/newsletter-consent-wording.ts — the sentence a visitor
// agrees to when they tick the marketing-consent checkbox beside the
// newsletter form's email field (components/public/NewsletterForm.tsx).
//
// Mirrors lib/lead-engine/sms-consent-wording.ts's shape exactly: a
// STANDALONE SENTENCE (not glued together from other constants), and
// `displayName` is a PARAMETER, never a constant — this file lives under
// `lib/lead-engine`, which __tests__/lib/lead-engine/no-brand-literals.test.ts
// sweeps for a hard-coded brand name, so there is nowhere for one to hide.
//
// Called from two places that must render IDENTICAL output for the same
// input: the checkbox's own visible text (hard-coded today in
// NewsletterForm.tsx, pinned against this template by
// __tests__/components/public/NewsletterForm.consent-wording.test.tsx) and
// POST /api/newsletter re-rendering it server-side from
// business_settings.display_name to file as contact_consents.wording_shown
// — evidence of what was actually shown, not a guess reconstructed later.
//
// This is a DIFFERENT thing from `NEWSLETTER_CONSENT_WORDING`
// (lib/lead-engine/capture.ts): that constant is the generic "a Subscribe
// button was clicked" act description, used for the newsletter route's
// second entry point (the inline blog capture, which shows no checkbox at
// all) and as the honest fallback here when no business name is configured
// to fill this template.

export function renderNewsletterConsentWording(displayName: string): string {
  return `I consent to receiving marketing emails from ${displayName}, including the use of my hashed email for personalized advertising on Google. I can opt out at any time.`
}

/**
 * True only when `displayName` actually names a business — non-blank once
 * whitespace is trimmed. Mirrors `hasSmsConsentDisplayName`
 * (lib/lead-engine/sms-consent-wording.ts) for the identical reason:
 * `business_settings.display_name` is seeded `''` (migration 00212 — NOT
 * NULL DEFAULT `''`), the state of any install nobody has configured yet,
 * including production today. Feeding that straight into
 * `renderNewsletterConsentWording` produces "I consent to receiving
 * marketing emails from , including..." — a sentence that cannot name who
 * is collecting consent is not consent to anything, so the caller must fall
 * back to the generic act wording instead of filing this template unfilled.
 */
export function hasNewsletterConsentDisplayName(displayName: string | null | undefined): displayName is string {
  return Boolean(displayName?.trim())
}
