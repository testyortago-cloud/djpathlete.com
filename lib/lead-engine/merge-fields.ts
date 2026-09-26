// lib/lead-engine/merge-fields.ts — the `{{tokens}}` a sequence step may use,
// and the one place the set is defined.
//
// PURE, AND THAT IS WHY IT IS ITS OWN FILE rather than living in
// lib/lead-engine/email.ts. The step editor is a client component and needs
// the same list to warn a coach about a token nothing will fill in; email.ts
// constructs a `Resend` client at module scope, so importing it from the
// browser bundle would ship the provider SDK to every visitor. Same split, and
// the same reason, as sequence-exit-reasons.ts and manual-enrol.ts.
//
// THE METADATA KEYS COME FROM `ENROLMENT_METADATA_KEYS`, not from a second
// list written out here. That array is already the allow-list deciding what a
// run may remember and what a coach may branch on; a separate copy would let
// the two drift, and the drift shows up as a merge field that renders blank
// forever because nothing writes the key.
//
// `{{sport}}` IS HERE SINCE G16 (2026-09-27), and only by way of that array:
// the inquiry route now passes the application form's "Sport / Activity"
// answer into the event metadata, so `sport` became an ENROLMENT_METADATA_KEYS
// entry, which is also what made it a branchable key in the editor. It is
// blank for anyone whose front door does not pass it on: the event signup and
// checkout routes collect a sport too and do not (yet) pass it; a funnel form
// with a field named `sport` does, since a funnel passes its whole payload.
//
// WHY `{{goals}}` IS NOT. It is FREE PROSE, and enrolment-metadata.ts says in
// as many words that its 120-character cap exists so "nothing resembling prose
// (or a pasted note) can land in a column a branch compares with `=`". A
// paragraph about somebody's ambitions is exactly what that cap refuses, so
// wiring it through would produce a merge field that silently renders blank
// for the answers people actually write. It renders blank rather than shipping
// visible braces to a real person, and the editor warns about it.

import { ENROLMENT_METADATA_KEYS, type EnrolmentMetadata } from "@/lib/lead-engine/enrolment-metadata"

/**
 * The LINK placeholder, which this module deliberately does not own.
 *
 * `{{sms_consent_url}}` is substituted by the renderer AFTER HTML-escaping, so
 * the anchor survives. Blanking it as "unknown" would leave the one step whose
 * entire purpose is that link with nothing in it, so it is named here and left
 * exactly as written everywhere below.
 *
 * `{{unsubscribe_url}}` IS NOT ON THIS LIST, and that is a correction.
 * Migration 00271's comment claims "the substitutions the renderer knows are
 * {{name}}, {{unsubscribe_url}} and {{sms_consent_url}}" — but nothing in this
 * repo has ever substituted it. Declaring it known here would have kept the
 * editor silent about a token that mails out as literal braces. The unsubscribe
 * link is rendered unconditionally in the FOOTER, by the layout, so an inline
 * one was never needed; a coach who types it now gets a blank and a warning
 * saying so.
 */
export const LINK_PLACEHOLDER_KEYS = ["sms_consent_url"] as const

/** Every token that gets a VALUE. `name` and `first_name` plus the run's memory. */
export const MERGE_FIELD_KEYS = ["name", "first_name", ...ENROLMENT_METADATA_KEYS] as const

export type MergeFieldKey = (typeof MERGE_FIELD_KEYS)[number]

/** Matches `{{ anything }}`, so an UNKNOWN token can be found rather than shipped. */
const MERGE_TOKEN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi

const KNOWN = new Set<string>([...MERGE_FIELD_KEYS, ...LINK_PLACEHOLDER_KEYS])

/**
 * Every value that may be spliced into a template is collapsed to one line
 * first.
 *
 * `contactName` and the metadata values are funnel-submitted text, so they are
 * attacker-controllable, and they land in the SUBJECT — a mail header. A bare
 * newline there is header injection wherever the transport passes it through,
 * and a mangled subject in most clients even where it does not. Stripping
 * happens here, once, rather than at each splice point, so a future caller
 * cannot forget it.
 */
function oneLine(value: string | null | undefined): string {
  // Braces go too (G16 review). email.ts fills `{{sms_consent_url}}` in AFTER
  // this, on the merged body, so a value that carried a token would become a
  // live consent link for whoever typed it. No name or answer needs a brace.
  return (
    value
      ?.replace(/[\r\n]+/g, " ")
      .replace(/[{}]/g, "")
      .trim() ?? ""
  )
}

/**
 * `{{name}}` with everything after the first space removed.
 *
 * DERIVED, not stored — there is no `first_name` column and this is not the
 * place to invent one. "Sam Athlete" gives "Sam"; a one-word name gives
 * itself; an empty name gives an empty string, which is the same answer
 * `{{name}}` gives and for the same reason.
 *
 * It is a SPLIT, not a parse. A name is not reliably "first last" in most of
 * the world, and this makes no attempt to be clever about the ones that are
 * not — a greeting that says "Hi Priya" when the person writes their family
 * name first is a small wrongness, and any rule that tried to do better would
 * be wrong in ways nobody could predict.
 */
export function firstNameOf(contactName: string | null | undefined): string {
  const whole = oneLine(contactName)
  return whole.split(" ")[0] ?? ""
}

/**
 * Fills in every merge field, and BLANKS the ones nobody wrote.
 *
 * An unknown token renders as nothing, which is the same answer a known token
 * with no value gives. The alternative is shipping `{{goals}}` as visible
 * template syntax to a real person — the failure this repo already guards
 * against for `{{sms_consent_url}}`, there by throwing, because that one is a
 * link on a consent page and a silent blank would be worse. For a
 * personalisation token a blank is the safe answer: "Hi," reads as slightly
 * plain, where "Hi {{first_name}}," reads as broken.
 */
export function substituteMergeFields(
  template: string,
  args: { contactName: string | null; metadata?: EnrolmentMetadata },
): string {
  const metadata = args.metadata ?? {}
  const values: Record<string, string> = {
    name: oneLine(args.contactName),
    first_name: firstNameOf(args.contactName),
  }
  for (const key of ENROLMENT_METADATA_KEYS) values[key] = oneLine(metadata[key])

  return template.replace(MERGE_TOKEN, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase()
    // Left exactly as written — see LINK_PLACEHOLDER_KEYS.
    if ((LINK_PLACEHOLDER_KEYS as readonly string[]).includes(key)) return whole
    return values[key] ?? ""
  })
}

/**
 * The tokens in this text that nothing will fill in, in the order they appear
 * and without repeats.
 *
 * For the step editor, which warns a coach as they type. ADVISORY, not a save
 * gate: a blank is already the safe outcome, and refusing to save copy over a
 * token would block a coach whose sequence is otherwise finished — while the
 * warning tells them exactly what the reader will see.
 */
export function unknownMergeFields(text: string | null | undefined): string[] {
  if (!text) return []
  const found: string[] = []
  for (const match of text.matchAll(MERGE_TOKEN)) {
    const key = match[1].toLowerCase()
    if (KNOWN.has(key) || found.includes(key)) continue
    found.push(key)
  }
  return found
}
