// functions/src/seo/signals.ts
// Signal-gathering functions for the SEO agent. Each one is a pure function
// of a Supabase client + parameters, returning a typed summary slice.
// Run in parallel from gatherSeoSignals().

import type { SupabaseClient } from "@supabase/supabase-js"

export interface GscSignals {
  total_clicks: number
  total_impressions: number
  avg_position: number
  top_winnable: Array<{ query: string; avg_position: number; impressions_28d: number; clicks_28d: number }>
  top_decayed: Array<{ slug: string; position_drop: number; clicks_28d: number; avg_position_recent: number }>
}

export interface InventorySignals {
  total_posts: number
  oldest_post_age_days: number
  never_refreshed_count: number
}

export interface TavilySignal {
  title: string
  score: number
  created_at: string
}

export interface MemoryOutcomeSignal {
  run_date: string
  tool: string
  outcome_status: string
  outcome_summary?: string
}

// Inlined locally — functions/tsconfig has rootDir: "src" so we can't import from ../../../lib.
export interface BriefContext {
  brief_id: string
  week_of: string
  themes: Array<{ tag: string; weight: number }>
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
}

export interface ToolPerformanceEntry {
  tool: string
  n_measured: number
  avg_impact_score: number
  p95_abs_delta: number
  success_rate: number
}

export interface SeoSignalsSummary {
  gsc_28d: GscSignals
  inventory: InventorySignals
  recent_tavily: TavilySignal[]
  orphan_post_ids: string[]
  last_8_memos_outcomes: MemoryOutcomeSignal[]
  /** Convenience: count of distinct dates in gsc_query_daily — used by the data warm-up gate. */
  gsc_distinct_dates: number
  /** Latest approved StrategyBrief; null when no approved brief exists for the current week. */
  brief_context: BriefContext | null
  /** Per-tool aggregates from agent_tool_baselines + recent measured memos. Empty array when no rows. */
  tool_performance: ToolPerformanceEntry[]
}

const TOP_K = 20
const ORPHAN_LOOKBACK_LIMIT = 200

// ─── Individual gatherers ───────────────────────────────────────────────────

export async function gatherCount28dDates(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("gsc_query_daily")
    .select("date", { count: "exact" })
    .gte("date", isoDateNDaysAgo(28))
  if (error) throw error
  // The select returns rows; count distinct via Set.
  const dates = new Set((data as Array<{ date: string }> | null)?.map((r) => r.date) ?? [])
  return dates.size
}

export async function gatherGscSignals(supabase: SupabaseClient): Promise<GscSignals> {
  // 28-day window aggregated per (query, page).
  const since = isoDateNDaysAgo(28)
  const { data: rawRows, error } = await supabase
    .from("gsc_query_daily")
    .select("query, page, impressions, clicks, position, date")
    .gte("date", since)
  if (error) throw error
  type Row = {
    query: string
    page: string
    impressions: number
    clicks: number
    position: number
    date: string
  }
  const rows = (rawRows as Row[] | null) ?? []

  // Site-wide totals
  const totalClicks = rows.reduce((acc, r) => acc + r.clicks, 0)
  const totalImpressions = rows.reduce((acc, r) => acc + r.impressions, 0)
  const avgPosition =
    totalImpressions > 0
      ? rows.reduce((acc, r) => acc + r.position * r.impressions, 0) / totalImpressions
      : 0

  // Aggregate per-query for the winnable pick.
  const perQuery = new Map<
    string,
    { impressions: number; clicks: number; weightedPosition: number }
  >()
  for (const r of rows) {
    const entry = perQuery.get(r.query) ?? { impressions: 0, clicks: 0, weightedPosition: 0 }
    entry.impressions += r.impressions
    entry.clicks += r.clicks
    entry.weightedPosition += r.position * r.impressions
    perQuery.set(r.query, entry)
  }
  const winnable = Array.from(perQuery.entries())
    .map(([query, agg]) => ({
      query,
      impressions_28d: agg.impressions,
      clicks_28d: agg.clicks,
      avg_position: agg.impressions > 0 ? agg.weightedPosition / agg.impressions : 0,
    }))
    .filter((q) => q.avg_position >= 8 && q.avg_position <= 20 && q.impressions_28d >= 50)
    .sort(
      (a, b) =>
        (20 - b.avg_position) * Math.log(1 + b.impressions_28d) -
        (20 - a.avg_position) * Math.log(1 + a.impressions_28d),
    )
    .slice(0, TOP_K)

  // Aggregate per-page for the decay pick (28d vs prior 28d).
  const recent: Record<string, { impressions: number; weightedPosition: number; clicks: number }> = {}
  for (const r of rows) {
    const e = recent[r.page] ?? { impressions: 0, weightedPosition: 0, clicks: 0 }
    e.impressions += r.impressions
    e.weightedPosition += r.position * r.impressions
    e.clicks += r.clicks
    recent[r.page] = e
  }

  const priorSince = isoDateNDaysAgo(56)
  const priorEnd = isoDateNDaysAgo(28)
  const { data: priorRowsRaw, error: priorErr } = await supabase
    .from("gsc_query_daily")
    .select("page, impressions, position")
    .gte("date", priorSince)
    .lt("date", priorEnd)
  if (priorErr) throw priorErr
  const priorRows =
    (priorRowsRaw as Array<{ page: string; impressions: number; position: number }> | null) ?? []
  const prior: Record<string, { impressions: number; weightedPosition: number }> = {}
  for (const r of priorRows) {
    const e = prior[r.page] ?? { impressions: 0, weightedPosition: 0 }
    e.impressions += r.impressions
    e.weightedPosition += r.position * r.impressions
    prior[r.page] = e
  }

  const decayed: Array<{ slug: string; position_drop: number; clicks_28d: number; avg_position_recent: number }> = []
  for (const [page, recentAgg] of Object.entries(recent)) {
    const priorAgg = prior[page]
    if (!priorAgg) continue
    if (recentAgg.impressions < 10 || priorAgg.impressions < 10) continue
    const recentPos = recentAgg.weightedPosition / recentAgg.impressions
    const priorPos = priorAgg.weightedPosition / priorAgg.impressions
    const drop = recentPos - priorPos
    if (drop < 5) continue
    // Derive the slug from the page URL — naive, expects /blog/<slug> in the path.
    const m = page.match(/\/blog\/([^/?#]+)/)
    if (!m) continue
    decayed.push({
      slug: m[1],
      position_drop: drop,
      clicks_28d: recentAgg.clicks,
      avg_position_recent: recentPos,
    })
  }
  decayed.sort((a, b) => b.position_drop - a.position_drop)

  return {
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    avg_position: avgPosition,
    top_winnable: winnable,
    top_decayed: decayed.slice(0, TOP_K),
  }
}

export async function gatherInventorySignals(supabase: SupabaseClient): Promise<InventorySignals> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, published_at, last_refreshed_at")
    .eq("status", "published")
  if (error) throw error
  type Row = { id: string; published_at: string | null; last_refreshed_at: string | null }
  const rows = (data as Row[] | null) ?? []
  const totalPosts = rows.length
  if (totalPosts === 0) {
    return { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 }
  }
  const now = Date.now()
  const oldestAgeMs = rows.reduce((acc, r) => {
    if (!r.published_at) return acc
    return Math.max(acc, now - new Date(r.published_at).getTime())
  }, 0)
  const neverRefreshedCount = rows.filter((r) => !r.last_refreshed_at).length
  return {
    total_posts: totalPosts,
    oldest_post_age_days: Math.floor(oldestAgeMs / 86_400_000),
    never_refreshed_count: neverRefreshedCount,
  }
}

export async function gatherTavilySignals(supabase: SupabaseClient): Promise<TavilySignal[]> {
  // Last 4 weeks of Tavily-sourced topic suggestions.
  const since = isoDateNDaysAgo(28)
  const { data, error } = await supabase
    .from("content_calendar")
    .select("title, metadata, created_at")
    .eq("entry_type", "topic_suggestion")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) throw error
  type Row = { title: string; metadata: { rank?: number; source?: string } | null; created_at: string }
  const rows = (data as Row[] | null) ?? []
  return rows
    .filter((r) => r.metadata?.source !== "seo_agent") // exclude rows we ourselves wrote earlier
    .map((r) => ({
      title: r.title,
      score: typeof r.metadata?.rank === "number" ? 1 / r.metadata.rank : 0,
      created_at: r.created_at,
    }))
}

export async function gatherOrphanPostIds(supabase: SupabaseClient): Promise<string[]> {
  // Cheap heuristic: a post is "orphaned" if no OTHER post's content references its slug
  // via /blog/<slug>. Pulls the most recent N published posts and checks for inbound refs.
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, slug, content")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(ORPHAN_LOOKBACK_LIMIT)
  if (error) throw error
  type Row = { id: string; slug: string; content: string }
  const rows = (data as Row[] | null) ?? []

  // Concatenate all content once; then check each slug's presence.
  const combinedContent = rows.map((r) => r.content ?? "").join("\n")
  const orphans: string[] = []
  for (const row of rows) {
    const needle = `/blog/${row.slug}`
    // split/join globally removes ALL occurrences of this post's content. Safer
    // than .replace() (first-match only) when posts share identical content blocks.
    const ownContent = row.content ?? ""
    const otherContent = ownContent ? combinedContent.split(ownContent).join("") : combinedContent
    if (!otherContent.includes(needle)) {
      orphans.push(row.id)
    }
  }
  return orphans
}

export async function gatherMemorySignals(supabase: SupabaseClient): Promise<MemoryOutcomeSignal[]> {
  const { data, error } = await supabase
    .from("seo_agent_memos")
    .select("run_date, actions, outcome_status, outcome_metrics")
    .order("run_date", { ascending: false })
    .limit(8)
  if (error) throw error
  type Row = {
    run_date: string
    actions: Array<{ tool: string }>
    outcome_status: string
    outcome_metrics: unknown
  }
  const rows = (data as Row[] | null) ?? []
  const out: MemoryOutcomeSignal[] = []
  for (const m of rows) {
    for (const a of m.actions ?? []) {
      out.push({
        run_date: m.run_date,
        tool: a.tool,
        outcome_status: m.outcome_status,
        outcome_summary: m.outcome_metrics ? JSON.stringify(m.outcome_metrics).slice(0, 200) : undefined,
      })
    }
  }
  return out
}

export async function gatherLatestApprovedBrief(
  supabase: SupabaseClient,
): Promise<BriefContext | null> {
  const briefRes = await supabase
    .from("strategy_briefs")
    .select("*")
    .eq("approval_status", "approved")
    .order("week_of", { ascending: false })
    .limit(1)
    .maybeSingle()
  const briefRow = briefRes.data as {
    id: string
    week_of: string
    themes: BriefContext["themes"]
    audience_focus: string
    priority_channel: BriefContext["priority_channel"]
    keywords_to_chase: string[]
    hooks_to_test: string[]
    ctas: string[]
    dont_do: string[]
  } | null
  if (!briefRow) return null
  return {
    brief_id: briefRow.id,
    week_of: briefRow.week_of,
    themes: briefRow.themes,
    audience_focus: briefRow.audience_focus,
    priority_channel: briefRow.priority_channel,
    keywords_to_chase: briefRow.keywords_to_chase,
    hooks_to_test: briefRow.hooks_to_test,
    ctas: briefRow.ctas,
    dont_do: briefRow.dont_do,
  }
}

export async function gatherToolPerformance(
  supabase: SupabaseClient,
): Promise<ToolPerformanceEntry[]> {
  // functions/ can't import from lib/ (rootDir: "src"), so we mirror the
  // baseline reader here. Joins agent_tool_baselines (seo channel) with a
  // 90-day rollup of impact_score from measured seo_agent_memos.
  const { data: baselines } = await supabase
    .from("agent_tool_baselines")
    .select("tool_name, n_measured, p95_abs_delta, success_rate")
    .eq("channel", "seo")
  if (!baselines) return []

  // Compute avg_impact_score from recent measured memos.
  const ninety = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data: memos } = await supabase
    .from("seo_agent_memos")
    .select("actions, impact_score")
    .eq("outcome_status", "measured")
    .gte("run_date", ninety)

  const sumByTool: Record<string, { sum: number; count: number }> = {}
  for (const m of (memos ?? []) as Array<{
    actions: Array<{ tool: string }>
    impact_score: number | null
  }>) {
    if (m.impact_score == null) continue
    for (const a of m.actions ?? []) {
      sumByTool[a.tool] ??= { sum: 0, count: 0 }
      sumByTool[a.tool].sum += m.impact_score
      sumByTool[a.tool].count += 1
    }
  }

  return (
    baselines as Array<{
      tool_name: string
      n_measured: number
      p95_abs_delta: number
      success_rate: number
    }>
  ).map((b) => {
    const agg = sumByTool[b.tool_name] ?? { sum: 0, count: 0 }
    return {
      tool: b.tool_name,
      n_measured: b.n_measured,
      avg_impact_score: agg.count > 0 ? Math.round(agg.sum / agg.count) : 0,
      p95_abs_delta: b.p95_abs_delta,
      success_rate: b.success_rate,
    }
  })
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export async function gatherSeoSignals(supabase: SupabaseClient): Promise<SeoSignalsSummary> {
  const [
    gsc,
    inventory,
    tavily,
    orphanIds,
    memory,
    gscDistinctDates,
    briefContext,
    toolPerformance,
  ] = await Promise.all([
    gatherGscSignals(supabase),
    gatherInventorySignals(supabase),
    gatherTavilySignals(supabase),
    gatherOrphanPostIds(supabase),
    gatherMemorySignals(supabase),
    gatherCount28dDates(supabase),
    gatherLatestApprovedBrief(supabase),
    gatherToolPerformance(supabase),
  ])
  return {
    gsc_28d: gsc,
    inventory,
    recent_tavily: tavily,
    orphan_post_ids: orphanIds,
    last_8_memos_outcomes: memory,
    gsc_distinct_dates: gscDistinctDates,
    brief_context: briefContext,
    tool_performance: toolPerformance,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
