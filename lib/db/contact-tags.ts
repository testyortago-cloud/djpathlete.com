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

/**
 * Is this error "the contact_tags table does not exist yet"?
 *
 * ------------------------------------------------------------------------
 * A DELIBERATE, TEMPORARY EXCEPTION TO "null AND [] ARE DIFFERENT ANSWERS".
 * ------------------------------------------------------------------------
 * Everywhere else in this file a failed read THROWS, because "the read broke"
 * and "this contact has no tags" must not look the same. This one error code is
 * the exception, and .github/workflows/apply-migrations.yml says why in its own
 * header: migrations apply on push to main via a path-filtered Action while
 * Vercel builds the same push, and NOTHING SEQUENCES THE TWO. "Keep migrations
 * additive and let code tolerate the old schema for one deploy."
 *
 * Without this, the deploy that lands before 00237 applies takes out
 * /admin/contacts -- a page that works today and has nothing to do with tags --
 * because its tag read throws into the admin error boundary. lib/db/funnel-leads.ts
 * restructured around exactly this hazard for exactly this screen.
 *
 * THE CODE IS PGRST205, NOT 42P01. Measured, not assumed: PostgREST resolves
 * table names against its own schema cache before the query reaches Postgres, so
 * a missing table comes back as
 *   { code: "PGRST205", message: "Could not find the table 'public.x' in the
 *     schema cache" }
 * and never as Postgres's undefined_table. A guard written against 42P01 would
 * never fire and the outage would happen anyway. 42P01 is matched too, for the
 * paths that reach Postgres directly (an RPC, or a stale cache), but PGRST205 is
 * the one that actually does the work here.
 *
 * REMOVE THIS once 00237 is confirmed applied to production. It is scaffolding
 * for one deploy, not a permanent softening -- and while it stands, every OTHER
 * error still throws.
 */
export function isMissingTagsTable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === "PGRST205" || code === "42P01"
}

/** Every tag on one contact, alphabetical so the pills do not reorder between renders. */
export async function listTags(contactId: string, businessId: string): Promise<ContactTag[]> {
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
  businessId: string
}): Promise<{ tag: string; created: boolean }> {
  const tag = normaliseTag(input.tag)
  if (tag === null) throw new Error("addTag: tag is empty or too long after normalisation")

  const supabase = getClient()
  const { error } = await supabase.from("contact_tags").insert({
    business_id: input.businessId,
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
  businessId: string
}): Promise<{ tag: string }> {
  const tag = normaliseTag(input.tag)
  if (tag === null) throw new Error("removeTag: tag is empty or too long after normalisation")

  const supabase = getClient()
  const { error } = await supabase
    .from("contact_tags")
    .delete()
    .eq("business_id", input.businessId)
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
export async function tagsForContacts(contactIds: string[], businessId: string): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>()
  if (contactIds.length === 0) return byContact

  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_tags")
    .select("contact_id, tag")
    .eq("business_id", businessId)
    .in("contact_id", contactIds)
    .order("tag", { ascending: true })
  // See isMissingTagsTable: the ONE error this read may swallow, and only until
  // 00237 has landed in production. A contact list that renders without pills is
  // a degraded page; a contact list that renders the error boundary is an outage.
  if (error && isMissingTagsTable(error)) {
    console.warn("tagsForContacts: contact_tags does not exist yet (migration 00237 pending); rendering without tags")
    return byContact
  }
  if (error) throw new Error(`tagsForContacts: ${error.message}`)

  for (const row of (data ?? []) as { contact_id: string; tag: string }[]) {
    const existing = byContact.get(row.contact_id)
    if (existing) existing.push(row.tag)
    else byContact.set(row.contact_id, [row.tag])
  }
  return byContact
}
