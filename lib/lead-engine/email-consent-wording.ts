// lib/lead-engine/email-consent-wording.ts — the sentence a funnel visitor
// agrees to when they tick the email opt-in box beside an email field.
//
// MIRRORS lib/lead-engine/sms-consent-wording.ts EXACTLY. See that file's
// header for the full reasoning; this repeats only what differs.
//
// Brand-neutral on purpose: the chat's own permission sentence names
// "coaching, camps and clinics" specifically, which not every coach on the
// platform sells. This sentence names nothing but the business itself.
//
// Email sending stays UNGATED (the owner's ruling of 2026-09-07) — ticking
// this box records consent, it never decides whether an email goes out.
//
// `displayName` is a PARAMETER, never a constant: this file lives under
// `lib/lead-engine`, which `__tests__/lib/lead-engine/no-brand-literals.test.ts`
// sweeps for a hard-coded brand name, so there is nowhere for one to hide.
//
// Called from two places, and they must render IDENTICAL output for the
// same input: the form/quiz/inquiry server wrapper shows this to the visitor
// before they tick the box, and the submit route re-renders it server-side
// to file as `contact_consents.wording_shown` — evidence of what was
// actually shown, not a guess reconstructed later.

export function renderEmailConsentWording(displayName: string): string {
  return `Yes, ${displayName} can email me training tips, news and offers. I can unsubscribe at any time.`
}

/**
 * True only when `displayName` actually names a business — non-blank once
 * whitespace is trimmed.
 *
 * `business_settings.display_name` is seeded `''` (migration 00212 — NOT
 * NULL DEFAULT `''`), which is the state of any install nobody has
 * configured yet, including production today. Feeding that straight into
 * `renderEmailConsentWording` produces "Yes,  can email me training tips,
 * news and offers." — a sentence that cannot name who is emailing is not
 * consent to anything.
 *
 * This is the ONE gate both call sites check, so "blank" and "the settings
 * read failed" collapse to the same outcome everywhere: the server wrapper
 * (deciding whether to show the checkbox at all) and the submit route
 * (deciding whether to file the consent row) must never disagree about
 * whether a name was usable — a checkbox rendered from one verdict and a
 * consent row filed from the other is exactly the shown-vs-recorded
 * mismatch this function exists to rule out.
 */
export function hasEmailConsentDisplayName(displayName: string | null | undefined): displayName is string {
  return Boolean(displayName?.trim())
}
