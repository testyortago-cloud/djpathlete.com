// lib/db/content-attribution.ts
// DAL for content_attribution_snapshots + source-query helpers.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { JoinerInput, JoinerRow } from "@/lib/automation/content-revenue-joiner"

const SEVEN_DAYS_MS = 7 * 86_400_000
const ATTRIBUTION_LOOKBACK_DAYS = 30

export async function fetchJoinerInput(supabase: SupabaseClient): Promise<JoinerInput> {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10)
  const lookback = new Date(Date.now() - ATTRIBUTION_LOOKBACK_DAYS * 86_400_000).toISOString()

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("id, slug")
    .eq("status", "published")

  const { data: gsc } = await supabase
    .from("gsc_query_daily")
    .select("page, clicks, impressions")
    .gte("date", sevenDaysAgo)

  const { data: attributions } = await supabase
    .from("marketing_attribution")
    .select("user_id, landing_url")
    .gte("first_seen_at", lookback)
    .not("landing_url", "is", null)

  const { data: payments } = await supabase
    .from("payments")
    .select("user_id, amount_cents, status")
    .eq("status", "succeeded")

  return {
    posts: (posts ?? []) as JoinerInput["posts"],
    gsc: (gsc ?? []).map((r) => ({
      page: (r as { page: string }).page,
      clicks: (r as { clicks: number | null }).clicks ?? 0,
      impressions: (r as { impressions: number | null }).impressions ?? 0,
    })),
    attributions: (attributions ?? []) as JoinerInput["attributions"],
    payments: (payments ?? []) as JoinerInput["payments"],
  }
}

export async function upsertAttributionSnapshots(
  supabase: SupabaseClient,
  week_of: string,
  rows: JoinerRow[],
): Promise<void> {
  if (rows.length === 0) return
  const payload = rows.map((r) => ({ week_of, attribution_model: "first_touch_landing", ...r }))
  const { error } = await supabase
    .from("content_attribution_snapshots")
    .upsert(payload, { onConflict: "week_of,blog_post_id,attribution_model" })
  if (error) throw new Error(`upsertAttributionSnapshots: ${error.message}`)
}

export interface AttributionRow {
  id: string
  week_of: string
  blog_post_id: string
  gsc_clicks_7d: number
  gsc_impressions_7d: number
  sessions_from_post_7d: number
  bookings_attributed: number
  revenue_attributed_cents: number
  attribution_model: string
  created_at: string
  blog_posts: { title: string; slug: string } | null
}

export async function topByRevenue(
  supabase: SupabaseClient,
  weeks = 4,
  limit = 20,
): Promise<AttributionRow[]> {
  const cutoff = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from("content_attribution_snapshots")
    .select("*, blog_posts:blog_post_id (title, slug)")
    .gte("week_of", cutoff)
    .order("revenue_attributed_cents", { ascending: false })
    .limit(limit)
  return (data ?? []) as AttributionRow[]
}
