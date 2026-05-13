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
