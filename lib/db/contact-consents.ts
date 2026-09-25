import { createServiceRoleClient } from "@/lib/supabase"

export type ConsentChannel = "email" | "sms"

function getClient() {
  return createServiceRoleClient()
}

export async function recordConsent(input: {
  contactId: string
  channel: ConsentChannel
  granted: boolean
  source: string
  wordingShown: string
  ip?: string | null
  userAgent?: string | null
  businessId: string
}): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("contact_consents").insert({
    business_id: input.businessId,
    contact_id: input.contactId,
    channel: input.channel,
    granted: input.granted,
    source: input.source,
    wording_shown: input.wordingShown,
    ip_address: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  })
  if (error) throw error
}

/**
 * The most recent record wins. A read failure throws rather than returning
 * false: "could not read" and "they said no" are different answers, and only
 * one of them is safe to act on.
 *
 * `businessId` is REQUIRED, and it is not redundant with `contactId` (G35).
 * `contact_consents` has two SEPARATE foreign keys, `business_id ->
 * businesses` and `contact_id -> contacts`, no composite one, and
 * `business_id` DEFAULTS to the platform's id. Nothing in the schema makes a
 * consent row's business equal its contact's, so without this predicate a row
 * filed under another business, or defaulted to the platform's by a writer
 * that forgot the column, would answer for this one. The dev clone had 0
 * mismatched rows of 59 when the predicate was added: the answer was correct
 * by data, and this makes it correct by construction instead.
 *
 * The predicate is IN THE QUERY, before `.limit(1)`, not a check on the row
 * that comes back. "The most recent record" means the most recent record in
 * THIS business: another business's newer revoke must not cancel this
 * business's grant, and a comparison made after the limit would let it.
 *
 * It comes after `channel` rather than first, like every other tenant
 * parameter in this module (`isSuppressed`, `suppress`, `unsuppress`). Both
 * ids are strings, so the compiler cannot catch a swap; the suite seeds a row
 * under one business and asks under another to catch it instead.
 *
 * `contactsWithEmailConsent` (lib/db/sequence-reporting.ts) applies the same
 * predicate in bulk, which is what lets that report claim it cannot disagree
 * with this function about one person.
 */
export async function hasConsent(contactId: string, channel: ConsentChannel, businessId: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("granted")
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
    .eq("channel", channel)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return false
  return Boolean(data.granted)
}

export async function suppress(identifier: string, reason: string, businessId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("contact_suppressions")
    .insert({ business_id: businessId, identifier: identifier.toLowerCase(), reason })
  // 23505 is Postgres's unique_violation code — this identifier is already
  // suppressed, which is the outcome this call wanted anyway. Matching the
  // code instead of sniffing error.message for the word "duplicate" matters:
  // a genuine failure whose message happens to contain that word (e.g. a
  // permissions error on a table with "duplicate" in its constraint name)
  // must not be swallowed.
  if (error && (error as { code?: string }).code !== "23505") throw error
}

/**
 * The inverse of `suppress`: deletes the suppression row for the lowercased
 * identifier, keyed the same way `suppress` writes it. Used by the Twilio
 * inbound webhook's START/UNSTOP/YES path (a contact who opts back in must
 * stop being suppressed, symmetrically with how STOP suppresses them).
 *
 * Absent row is success, not an error — unlike `suppress`'s insert, a
 * Postgres DELETE that matches zero rows returns `{ error: null }` on its
 * own (there is no unique-constraint violation to swallow the way `suppress`
 * has to for a duplicate insert), so no special-case error-code handling is
 * needed here to get that idempotency: calling this for an identifier that
 * was never suppressed, or calling it twice in a row, both succeed silently.
 */
export async function unsuppress(identifier: string, businessId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("contact_suppressions")
    .delete()
    .eq("business_id", businessId)
    .eq("identifier", identifier.toLowerCase())
  if (error) throw error
}

export async function isSuppressed(identifier: string, businessId: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_suppressions")
    .select("id")
    .eq("business_id", businessId)
    .eq("identifier", identifier.toLowerCase())
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}
