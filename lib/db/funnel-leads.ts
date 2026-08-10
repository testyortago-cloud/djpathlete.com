// lib/db/funnel-leads.ts — reading and working the leads a funnel captured.
//
// A separate file from `lib/db/funnels.ts` because it answers a different
// question. That file is about PAGES — funnels, steps, versions, and the one
// insert that records a submission. This one is about the PEOPLE those pages
// captured: who came in, from which page, what they said, and what has been
// done about it.
//
// It exists at all because until now nothing did. `listSubmissions()` has been
// sitting in funnels.ts since the subsystem shipped, imported by no file in the
// repo, while the only lead surface anywhere was a count badge on the funnels
// board. Leads were being captured and were unreadable.
//
// EVERY LIST READ IS PAGINATED. `funnel_submissions` is a growth table and
// PostgREST silently caps `.select()` at ~1000 rows — the failure mode is not
// an error, it is a page that quietly stops showing older leads once the
// business gets busy enough for it to matter.

import { createServiceRoleClient } from "@/lib/supabase"
import type { FunnelLeadStatus, FunnelSubmission } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

/** A lead with the page it came from, which is the first thing anyone asks. */
export interface FunnelLead extends FunnelSubmission {
  funnel_name: string | null
  funnel_slug: string | null
  step_name: string | null
}

export interface LeadFilters {
  funnelId?: string
  stepId?: string
  status?: FunnelLeadStatus
  /** ISO timestamp; leads created at or after it. */
  since?: string
  /** Matches name, email or phone, case-insensitively. */
  search?: string
  limit?: number
  offset?: number
}

/** PostgREST's cap. Reads that could exceed it page rather than truncate. */
const PAGE = 1000

const SELECT_WITH_PAGE = "*, funnels:funnel_id (name, slug), funnel_steps:step_id (name)"

interface JoinedRow extends FunnelSubmission {
  funnels: { name: string | null; slug: string | null } | null
  funnel_steps: { name: string | null } | null
}

function flatten(row: JoinedRow): FunnelLead {
  const { funnels, funnel_steps, ...submission } = row
  return {
    ...submission,
    funnel_name: funnels?.name ?? null,
    funnel_slug: funnels?.slug ?? null,
    step_name: funnel_steps?.name ?? null,
  }
}

/**
 * The three chainable methods this file needs from a PostgREST query builder.
 *
 * Declared structurally rather than imported: the repo drops the `Database`
 * generic (see `lib/supabase.ts`), so the builder's real type is wide enough
 * that threading it through a generic helper costs more casts than it prevents.
 * Every method returns the builder, so the chain composes.
 */
interface Filterable {
  eq(column: string, value: unknown): Filterable
  gte(column: string, value: unknown): Filterable
  or(filter: string): Filterable
}

/**
 * Applies every filter that translates directly to PostgREST.
 *
 * ONE PLACE, used by the list read, the count and the export — so a filter that
 * narrows the table cannot narrow the count differently, which is how a page
 * ends up reporting "12 leads" above a list of 3.
 */
function applyFilters<T>(query: T, filters: LeadFilters): T {
  let q = query as Filterable
  if (filters.funnelId) q = q.eq("funnel_id", filters.funnelId)
  if (filters.stepId) q = q.eq("step_id", filters.stepId)
  if (filters.status) q = q.eq("status", filters.status)
  if (filters.since) q = q.gte("created_at", filters.since)
  const search = searchClause(filters.search)
  if (search) q = q.or(search)
  return q as T
}

/**
 * A PostgREST `or` filter across the three contact columns.
 *
 * Commas and parentheses SEPARATE and GROUP in PostgREST's filter grammar, so a
 * search for "Smith, John" or "(coach)" would be read as extra conditions
 * rather than as text — at best a wrong result, at worst a 400 that reads to
 * the user as "search is broken". Stripping them is lossy and honest; the
 * alternative is quoting rules that differ per operator.
 */
export function searchClause(term: string | undefined): string | null {
  const cleaned = (term ?? "")
    .trim()
    .replace(/[(),*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned.length === 0) return null
  return `name.ilike.%${cleaned}%,email.ilike.%${cleaned}%,phone.ilike.%${cleaned}%`
}

/** One page of leads, newest first. */
export async function listLeads(filters: LeadFilters = {}): Promise<FunnelLead[]> {
  const supabase = getClient()
  const limit = Math.min(filters.limit ?? 100, PAGE)
  const offset = filters.offset ?? 0

  const base = supabase.from("funnel_submissions").select(SELECT_WITH_PAGE)
  const filtered = applyFilters(base, filters)
  const { data, error } = await (filtered as typeof base)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new Error(`listLeads: ${error.message}`)
  return ((data ?? []) as JoinedRow[]).map(flatten)
}

/** How many leads match, for pagination and for the header count. */
export async function countLeads(filters: LeadFilters = {}): Promise<number> {
  const supabase = getClient()
  const base = supabase.from("funnel_submissions").select("id", { count: "exact", head: true })
  const filtered = applyFilters(base, filters)
  const { count, error } = await (filtered as typeof base)
  if (error) throw new Error(`countLeads: ${error.message}`)
  return count ?? 0
}

/**
 * Every matching lead, for CSV export.
 *
 * Paginated rather than one big `.select()`: an export that silently stops at
 * 1000 rows is worse than one that fails, because it produces a plausible file
 * that is missing leads with no indication that anything is absent.
 */
export async function listLeadsForExport(filters: LeadFilters = {}): Promise<FunnelLead[]> {
  const out: FunnelLead[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await listLeads({ ...filters, limit: PAGE, offset })
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

export async function getLead(id: string): Promise<FunnelLead | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("funnel_submissions").select(SELECT_WITH_PAGE).eq("id", id).maybeSingle()
  if (error) throw new Error(`getLead: ${error.message}`)
  return data ? flatten(data as JoinedRow) : null
}

/**
 * Moves a lead's follow-up state.
 *
 * `status_changed_at` is stamped HERE rather than by a trigger so the write and
 * its timestamp are one statement and cannot disagree — and so a status set
 * back to what it already was still records that someone looked.
 */
export async function setLeadStatus(id: string, status: FunnelLeadStatus): Promise<FunnelLead> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("funnel_submissions")
    .update({ status, status_changed_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT_WITH_PAGE)
    .single()
  if (error) throw new Error(`setLeadStatus: ${error.message}`)
  return flatten(data as JoinedRow)
}

/** Coach-side free text. Empty string clears it rather than storing "". */
export async function setLeadNotes(id: string, notes: string): Promise<FunnelLead> {
  const supabase = getClient()
  const trimmed = notes.trim()
  const { data, error } = await supabase
    .from("funnel_submissions")
    .update({ notes: trimmed.length > 0 ? trimmed : null })
    .eq("id", id)
    .select(SELECT_WITH_PAGE)
    .single()
  if (error) throw new Error(`setLeadNotes: ${error.message}`)
  return flatten(data as JoinedRow)
}

/**
 * Counts by status for the whole inbox, for the filter chips.
 *
 * Three `head: true` counts rather than one grouped query: PostgREST has no
 * GROUP BY, and pulling every row back to count them in JS is exactly the
 * unpaginated read this file exists to avoid.
 */
export async function countLeadsByStatus(filters: LeadFilters = {}): Promise<Record<FunnelLeadStatus, number>> {
  const [newCount, contacted, signedUp] = await Promise.all([
    countLeads({ ...filters, status: "new" }),
    countLeads({ ...filters, status: "contacted" }),
    countLeads({ ...filters, status: "signed_up" }),
  ])
  return { new: newCount, contacted, signed_up: signedUp }
}
