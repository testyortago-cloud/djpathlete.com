// lib/db/contacts-list.ts — reading the contact spine as a LIST.
//
// A separate file from `lib/db/contacts.ts` because it answers a different
// question. That file is about ONE PERSON: matching an inbound identifier to
// an existing human, merging two records that turned out to be the same
// person, appending a timeline event. This one is about the WHOLE TABLE —
// who is in it, and which of them you want to do something with.
//
// It exists at all because until now nothing did. `contacts` has been filling
// up since migration 00213 (funnel captures, and ~90 rows imported from
// GoHighLevel) and there was no function anywhere in the repo that could
// return more than one of them. The table was write-only from the app's point
// of view.
//
// EVERY LIST READ IS PAGINATED, for the reason lib/db/funnel-leads.ts's header
// spells out: PostgREST silently caps a `.select()` at ~1000 rows, and the
// failure mode is not an error — it is a page that quietly stops showing older
// contacts once the business gets big enough for it to matter.
//
// THE COLUMN IS `phone_e164`, NOT `phone`. Migration 00213 has no `phone`
// column at all. `funnel_submissions` does, which is exactly why this is worth
// a sentence: the obvious copy-paste from lib/db/funnel-leads.ts produces a
// search clause PostgREST rejects outright, and a 400 on the search box reads
// to a coach as "search is broken", not as "wrong column name".

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

function getClient() {
  return createServiceRoleClient()
}

/** The columns a list needs. Deliberately not `*` — see SELECT_COLUMNS. */
export interface ContactListRow {
  id: string
  name: string | null
  email: string | null
  phone_e164: string | null
  created_at: string
}

export interface ContactFilters {
  /** Matches name, email or phone_e164, case-insensitively. */
  search?: string
  /** Only contacts with an email address on file. */
  hasEmail?: boolean
  /** Only contacts with a phone number on file. */
  hasPhone?: boolean
  /** ISO timestamp; contacts created at or after it. */
  since?: string
  limit?: number
  offset?: number
}

/** PostgREST's cap. Reads that could exceed it page rather than truncate. */
const PAGE = 1000

/**
 * Named columns, not `*`. `contacts` also carries `user_id`,
 * `first_touch_session_id` and `timezone`, none of which this list shows —
 * and a list surface is the wrong place to widen the amount of personal data
 * being pulled out of the spine by default.
 */
const SELECT_COLUMNS = "id, name, email, phone_e164, created_at"

/** Longest search term worth sending. A 500-character `ilike` matches nothing slowly. */
const MAX_SEARCH_LENGTH = 120

/**
 * The four chainable methods this file needs from a PostgREST query builder.
 *
 * Declared structurally rather than imported, the same way
 * lib/db/funnel-leads.ts declares its own: the repo drops the `Database`
 * generic (see `lib/supabase.ts`), so the builder's real type is wide enough
 * that threading it through a generic helper costs more casts than it prevents.
 */
interface Filterable {
  eq(column: string, value: unknown): Filterable
  gte(column: string, value: unknown): Filterable
  or(filter: string): Filterable
  not(column: string, operator: string, value: unknown): Filterable
}

/**
 * Applies every filter that translates directly to PostgREST.
 *
 * ONE PLACE, used by the list read AND the count — so a filter that narrows
 * the table cannot narrow the count differently, which is how a page ends up
 * reporting "12 contacts" above a list of 3. This is not a hypothetical: it is
 * the exact bug lib/db/funnel-leads.ts's own `applyFilters` comment exists to
 * prevent, and it matters more here because the count is what an operator uses
 * to decide whether their filter caught everyone before they enrol the lot.
 *
 * The business scope is applied HERE rather than at each call site for the same
 * reason: a read that forgets it is a cross-tenant leak the day a second row
 * exists in `businesses`, and there is only one place to forget it.
 */
function applyFilters<T>(query: T, filters: ContactFilters): T {
  let q = query as Filterable
  q = q.eq("business_id", SINGLETON_BUSINESS_ID)
  if (filters.hasEmail) q = q.not("email", "is", null)
  if (filters.hasPhone) q = q.not("phone_e164", "is", null)
  if (filters.since) q = q.gte("created_at", filters.since)
  const search = contactSearchClause(filters.search)
  if (search) q = q.or(search)
  return q as T
}

/**
 * A PostgREST `or` filter across the three identifying columns.
 *
 * Commas and parentheses SEPARATE and GROUP in PostgREST's filter grammar, so
 * a search for "Smith, John" or "(coach)" would be read as extra conditions
 * rather than as text — at best a wrong result, at worst a 400 that reads to
 * the user as "search is broken". Stripping them is lossy and honest; the
 * alternative is quoting rules that differ per operator.
 */
export function contactSearchClause(term: string | undefined): string | null {
  const cleaned = (term ?? "")
    .trim()
    .replace(/[(),*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
  if (cleaned.length === 0) return null
  return `name.ilike.%${cleaned}%,email.ilike.%${cleaned}%,phone_e164.ilike.%${cleaned}%`
}

/** The `has` URL values this page understands. Anything else is ignored. */
const HAS_VALUES = new Set(["email", "phone"])

/**
 * The highest page number a URL may name. 999 pages of 100 is 99,900 contacts —
 * far past anything this business will hold — and the cap exists to stop
 * `?page=99999999` turning into a `.range()` PostgREST has to seek past.
 */
const MAX_PAGE = 999

/**
 * Filters plus the page of them being asked for.
 *
 * `page` is 1-based and deliberately NOT an offset: an offset needs the page
 * size, and the page size is the caller's business — app/(admin)/admin/contacts
 * sets it to `MAX_ENROL_BATCH` so a select-all is exactly the biggest legal
 * batch. So this returns the page number and the call site multiplies it out.
 *
 * `applyFilters` never reads it, which matters: a stray `page` reaching the
 * query builder would become a filter on a column `contacts` does not have.
 */
export interface ContactPageFilters extends ContactFilters {
  /** 1-based, already validated. */
  page: number
}

/**
 * Turns raw URL strings into filters, DISCARDING anything that is not one of
 * the shapes this page defined.
 *
 * Lives in the DAL rather than in the page so the rejection is unit-testable
 * without rendering a server component — and so there is exactly one answer to
 * "what does `?days=junk` do", rather than one per surface that ever links here.
 *
 * `days` in particular is not merely wrong when it is junk, it is fatal:
 * `Number("junk")` is `NaN`, `new Date(Date.now() - NaN)` is an Invalid Date,
 * and `.toISOString()` on one THROWS. An unvalidated day count means a single
 * hand-edited URL renders the admin error boundary instead of a contact list.
 *
 * `page` is validated the same way and falls back to 1 rather than being
 * rejected, because a junk page number has an obvious right answer — the first
 * page — where a junk `days` does not. A negative or zero page would produce a
 * negative `.range()` start, which PostgREST answers with a 400.
 */
export function parseContactFilters(raw: {
  search?: string
  has?: string
  days?: string
  page?: string
}): ContactPageFilters {
  const filters: ContactPageFilters = { page: 1 }

  const search = (raw.search ?? "").trim().slice(0, MAX_SEARCH_LENGTH)
  if (search.length > 0) filters.search = search

  const has = raw.has ?? ""
  if (HAS_VALUES.has(has)) {
    if (has === "email") filters.hasEmail = true
    if (has === "phone") filters.hasPhone = true
  }

  const days = raw.days ?? ""
  if (/^\d{1,4}$/.test(days)) {
    const count = Number(days)
    if (count > 0) filters.since = new Date(Date.now() - count * 86_400_000).toISOString()
  }

  const page = raw.page ?? ""
  if (/^\d{1,3}$/.test(page)) {
    const number = Number(page)
    if (number >= 1 && number <= MAX_PAGE) filters.page = number
  }

  return filters
}

/** One page of contacts, newest first. */
export async function listContacts(filters: ContactFilters = {}): Promise<ContactListRow[]> {
  const supabase = getClient()
  const limit = Math.min(filters.limit ?? 100, PAGE)
  const offset = filters.offset ?? 0

  const base = supabase.from("contacts").select(SELECT_COLUMNS)
  const filtered = applyFilters(base, filters)
  const { data, error } = await (filtered as typeof base)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  // Throws rather than returning []. "The read failed" and "there are no
  // contacts" are different answers, and only one of them means the operator
  // should stop and look — see the admin error boundary note on
  // app/(admin)/admin/pipeline/page.tsx.
  if (error) throw new Error(`listContacts: ${error.message}`)
  return (data ?? []) as ContactListRow[]
}

/** How many contacts match, for the footer count and for pagination. */
export async function countContacts(filters: ContactFilters = {}): Promise<number> {
  const supabase = getClient()
  const base = supabase.from("contacts").select("id", { count: "exact", head: true })
  const filtered = applyFilters(base, filters)
  const { count, error } = await (filtered as typeof base)
  if (error) throw new Error(`countContacts: ${error.message}`)
  return count ?? 0
}
