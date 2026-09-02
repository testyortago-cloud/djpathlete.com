// lib/contacts/tag-format.ts — what counts as a tag, as a pure function.
//
// SEPARATE FROM lib/db/contact-tags.ts ON PURPOSE, and not for tidiness: the
// tag input is a client component, and the DAL imports
// `createServiceRoleClient` from @/lib/supabase. Importing the validator from
// there would pull the service-role client — and the reasoning around the key
// it uses — into the browser bundle. Same pure/impure split
// lib/permissions/registry.ts keeps from lib/permissions/guard.ts.
//
// Three callers share this one definition, which is the point: the client input
// rejects what the route rejects, and the route rejects what the DAL would
// store. A route validating the RAW string while the DAL stored a NORMALISED
// one would produce a tag the operator cannot delete by typing what they see.

/**
 * The longest tag worth storing. Long enough for "sms-repermission-2026-q3",
 * short enough that a pill cannot push the header off the screen.
 */
export const MAX_TAG_LENGTH = 40

/**
 * Trim, collapse internal whitespace, lowercase.
 *
 * Returns null for anything that normalises to nothing, and for anything too
 * long. That is the whole rejection rule: `null` means "not a tag", and the
 * caller turns it into a 400.
 *
 * LOWERCASING IS WHAT MAKES THE UNIQUE CONSTRAINT MEAN ANYTHING.
 * `contact_tags_unique UNIQUE (contact_id, tag)` is a raw byte comparison, so
 * without this "Coaching Lead", "coaching lead" and "coaching-lead " are three
 * different tags to the database and three separate pills on the screen.
 *
 * Control characters become spaces rather than causing a rejection — they
 * cannot be typed deliberately, and a paste carrying a stray tab or newline
 * should not cost the operator their tag. Collapsing them BEFORE the whitespace
 * squeeze is what makes "coaching<tab>lead" and "coaching lead" one tag.
 */
export function normaliseTag(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
  if (cleaned.length === 0) return null
  if (cleaned.length > MAX_TAG_LENGTH) return null
  return cleaned
}
