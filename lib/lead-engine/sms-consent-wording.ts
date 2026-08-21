// lib/lead-engine/sms-consent-wording.ts — the sentence a funnel visitor
// agrees to when they tick the SMS opt-in box beside a phone field.
//
// A STANDALONE SENTENCE, not `SMS_OPT_OUT_SENTENCE` (lib/lead-engine/sms.ts)
// plus a prefix glued on: a consent line reads to a visitor as one sentence,
// not two spliced together, so this file owns its own copy of the STOP/HELP
// clause — matching that constant's vocabulary rather than importing it,
// because the two constants must be able to change independently (e.g. if
// the outbound-text footer ever needs a comma the consent line doesn't).
//
// `displayName` is a PARAMETER, never a constant: this file lives under
// `lib/lead-engine`, which `__tests__/lib/lead-engine/no-brand-literals.test.ts`
// sweeps for a hard-coded brand name, so there is nowhere for one to hide.
//
// Called from two places, and they must render IDENTICAL output for the
// same input: the funnel form island shows this to the visitor before they
// tick the box, and the submit route re-renders it server-side to file as
// `contact_consents.wording_shown` — evidence of what was actually shown, not
// a guess reconstructed later.

export function renderSmsConsentWording(displayName: string): string {
  return `I agree to receive text messages from ${displayName} about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help.`
}

/**
 * True only when `displayName` actually names a business — non-blank once
 * whitespace is trimmed.
 *
 * `business_settings.display_name` is seeded `''` (migration 00212 — NOT
 * NULL DEFAULT `''`), which is the state of any install nobody has
 * configured yet, including production today. Feeding that straight into
 * `renderSmsConsentWording` produces "I agree to receive text messages from
 * about my inquiry." — a sentence that cannot name who is texting is not
 * consent to anything.
 *
 * This is the ONE gate both call sites check, so "blank" and "the settings
 * read failed" collapse to the same outcome everywhere: the funnel form
 * island (deciding whether to show the checkbox at all) and the submit
 * route (deciding whether to file the consent row) must never disagree
 * about whether a name was usable — a checkbox rendered from one verdict and
 * a consent row filed from the other is exactly the shown-vs-recorded
 * mismatch this function exists to rule out.
 */
export function hasSmsConsentDisplayName(displayName: string | null | undefined): displayName is string {
  return Boolean(displayName?.trim())
}
