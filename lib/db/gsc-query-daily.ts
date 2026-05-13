// lib/db/gsc-query-daily.ts
// Read shape: GscQueryDailyRow (types/database.ts). Write shape: GscRowInput below.
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface GscRowInput {
  date: string // YYYY-MM-DD
  query: string
  page: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/**
 * Idempotent upsert. Supabase's PostgREST upsert hits the
 * (date, query, page) primary key — re-syncing the same day
 * just overwrites the row with corrected numbers (GSC retroactively
 * adjusts the last 2 days of data).
 */
export async function upsertGscRows(rows: GscRowInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = getClient()
  // chunked to stay well under PostgREST request size limits
  const CHUNK = 1000
  let total = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error, count } = await supabase
      .from("gsc_query_daily")
      .upsert(slice, { onConflict: "date,query,page", count: "exact" })
    if (error) throw error
    total += count ?? slice.length
  }
  return total
}

export async function countRowsForDate(date: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("gsc_query_daily")
    .select("*", { count: "exact", head: true })
    .eq("date", date)
  if (error) throw error
  return count ?? 0
}

export interface GscStats {
  totalRows: number
  distinctDates: number
  latestDateWithData: string | null
  lastIngestAt: string | null
}

/**
 * Aggregate stats for the admin /integrations/gsc page. Single round trip;
 * computes distinct-date and latest-date from the same rowset rather than
 * issuing multiple counting queries.
 */
export async function getGscStats(): Promise<GscStats> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("gsc_query_daily")
    .select("date, ingested_at")
  if (error) throw error
  type Row = { date: string; ingested_at: string }
  const rows = (data as Row[] | null) ?? []
  if (rows.length === 0) {
    return { totalRows: 0, distinctDates: 0, latestDateWithData: null, lastIngestAt: null }
  }
  const dates = new Set<string>()
  let latestDate = rows[0].date
  let lastIngest = rows[0].ingested_at
  for (const r of rows) {
    dates.add(r.date)
    if (r.date > latestDate) latestDate = r.date
    if (r.ingested_at > lastIngest) lastIngest = r.ingested_at
  }
  return {
    totalRows: rows.length,
    distinctDates: dates.size,
    latestDateWithData: latestDate,
    lastIngestAt: lastIngest,
  }
}

export interface RecentGscRow {
  date: string
  query: string
  page: string
  impressions: number
  clicks: number
  position: number
}

/**
 * Top N recent rows by impressions, for a preview panel on the admin page.
 */
export async function getRecentTopRows(limit = 10): Promise<RecentGscRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("gsc_query_daily")
    .select("date, query, page, impressions, clicks, position")
    .order("date", { ascending: false })
    .order("impressions", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RecentGscRow[]
}
