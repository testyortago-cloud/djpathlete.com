// lib/db/contact-tags.ts — the tags on a contact.
//
// A JOIN TABLE (migration 00237), not a `text[]` on `contacts`. The header of
// that migration carries the full reasoning; the short version is that merging
// two contacts is one UPDATE with a join table and a lost-update race with an
// array.
//
// RLS ON THIS TABLE HAS A service_role POLICY AND NOTHING ELSE (00237, copying
// 00214). So every function here goes through `createServiceRoleClient()`. A
// browser or SSR-cookie client does not error on these tables — it returns
// ZERO ROWS, which renders as "this contact has no tags" and is
// indistinguishable from the truth. Same trap the timeline read has.
//
// NORMALISING THE TAG IS A WRITE-TIME DECISION, made here rather than at the
// call site, because `contact_tags_unique UNIQUE (contact_id, tag)` is a raw
// byte comparison: without it "Coaching Lead", "coaching lead" and
// "coaching-lead " are three different tags to the database and three separate
// pills on the screen. `normaliseTag` is exported so the route can reject what
// it would reject, rather than silently storing something the operator did not
// type. The rule itself lives in lib/contacts/tag-format.ts so the client-side
// input can share it without importing a Supabase client.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { MAX_TAG_LENGTH, normaliseTag } from "@/lib/contacts/tag-format"

// Re-exported so existing server-side callers can keep importing the rule from
// the DAL. The definition itself lives in lib/contacts/tag-format.ts because
// the tag input is a CLIENT component and must not pull the service-role
// client into the browser bundle.
export { MAX_TAG_LENGTH, normaliseTag }

function getClient() {
  return createServiceRoleClient()
}

export interface ContactTag {
  id: string
  contact_id: string
  tag: string
  created_at: string
  created_by: string | null
}

/** Every tag on one contact, alphabetical so the pills do not reorder between renders. */
export async function listTags(contactId: string, businessId: string = SINGLETON_BUSINESS_ID): Promise<ContactTag[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_tags")
    .select("id, contact_id, tag, created_at, created_by")
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
    .order("tag", { ascending: true })
  // Throws rather than returning []. "The read failed" and "this contact has
  // no tags" are different answers — see app/(admin)/admin/contacts/page.tsx.
  if (error) throw new Error(`listTags: ${error.message}`)
  return (data ?? []) as ContactTag[]
}

/**
 * Adds a tag. Idempotent: re-adding one the contact already has is a no-op,
 * not an error.
 *
 * The no-op is enforced by `contact_tags_unique` and detected by Postgres error
 * code 23505 (unique_violation), matched on the CODE and never by sniffing the
 * message for the word "duplicate" — the same rule `suppress` in
 * lib/db/contact-consents.ts documents, and for the same reason: a genuine
 * failure whose message happens to contain that word must not be swallowed.
 *
 * Returns whether a row was actually created, so the audit row can record
 * "added" separately from "was already there".
 */
export async function addTag(input: {
  contactId: string
  tag: string
  createdBy?: string | null
  businessId?: string
}): Promise<{ tag: string; created: boolean }> {
  const tag = normaliseTag(input.tag)
  if (tag === null) throw new Error("addTag: tag is empty or too long after normalisation")

  const supabase = getClient()
  const { error } = await supabase.from("contact_tags").insert({
    business_id: input.businessId ?? SINGLETON_BUSINESS_ID,
    contact_id: input.contactId,
    tag,
    created_by: input.createdBy ?? null,
  })
  if (error) {
    if ((error as { code?: string }).code === "23505") return { tag, created: false }
    throw new Error(`addTag: ${error.message}`)
  }
  return { tag, created: true }
}

/**
 * Removes a tag. Idempotent the other way: removing one that is not there
 * succeeds, because a DELETE matching zero rows is not an error in Postgres.
 *
 * Normalises first, for the reason `normaliseTag` documents — the stored value
 * is the normalised one, so deleting by the raw string would miss it.
 */
export async function removeTag(input: {
  contactId: string
  tag: string
  businessId?: string
}): Promise<{ tag: string }> {
  const tag = normaliseTag(input.tag)
  if (tag === null) throw new Error("removeTag: tag is empty or too long after normalisation")

  const supabase = getClient()
  const { error } = await supabase
    .from("contact_tags")
    .delete()
    .eq("business_id", input.businessId ?? SINGLETON_BUSINESS_ID)
    .eq("contact_id", input.contactId)
    .eq("tag", tag)
  if (error) throw new Error(`removeTag: ${error.message}`)
  return { tag }
}

/**
 * Tags for MANY contacts at once, as a Map keyed by contact id.
 *
 * Exists so the 100-row list can show pills in ONE round trip instead of 100.
 * The Map is built with a per-row push and NOT with a deduping helper: two
 * different contacts legitimately share a tag, and a helper that keys on the
 * tag would silently drop one of them.
 *
 * An empty `contactIds` returns an empty Map WITHOUT querying — `.in("id", [])`
 * is a legal query that matches nothing, but paying a round trip to learn that
 * is waste.
 */
export async function tagsForContacts(
  contactIds: string[],
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>()
  if (contactIds.length === 0) return byContact

  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_tags")
    .select("contact_id, tag")
    .eq("business_id", businessId)
    .in("contact_id", contactIds)
    .order("tag", { ascending: true })
  if (error) throw new Error(`tagsForContacts: ${error.message}`)

  for (const row of (data ?? []) as { contact_id: string; tag: string }[]) {
    const existing = byContact.get(row.contact_id)
    if (existing) existing.push(row.tag)
    else byContact.set(row.contact_id, [row.tag])
  }
  return byContact
}
