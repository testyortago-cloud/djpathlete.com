import type { SupabaseClient } from "@supabase/supabase-js"

const LOOKBACK_DAYS = 28
const SIGNAL_LOOKBACK = 4
const MIN_CHANNELS_WITH_MEMO = 2

/**
 * What the critic can honestly say about each first-touch channel.
 *
 * G41. This used to promise `bookings` and `revenue` per channel, read from
 * `marketing_attribution` columns (`channel`, `event_type`, `occurred_at`,
 * `revenue_cents`) that have never existed: not in 00101, which creates the
 * table, nor in any later migration. PostgREST refused the read with 42703,
 * the error was never looked at, and `data ?? []` turned it into "no
 * attribution". The critic has never seen a single row.
 *
 * `marketing_attribution` is one row per visitor SESSION, stamped with how the
 * visitor first arrived (click ids, UTM tags, referrer) and, once they became
 * a known person, `claimed_at`. So what it can answer is how many sessions
 * each channel brought, and how many of those became a lead. Bookings and
 * revenue are not in it, and are left out rather than reported as zero.
 *
 * WHAT IS AND IS NOT A ROW. A session is recorded only for a TAGGED landing
 * (click id or UTM) or a `/go/` funnel landing (proxy.ts). An untagged visit to
 * the blog or the marketing pages is never recorded, so organic search is
 * mostly invisible here. The prompt says so.
 *
 * WHAT A LEAD IS. A session is a lead when it was claimed (the visitor applied,
 * registered or subscribed: `claimAttribution`) OR a funnel form was submitted
 * from it. The funnel route links its submission by
 * `funnel_submissions.attribution_session_id` and never claims, so counting
 * `claimed_at` alone read every funnel as converting at 0% (G41 review).
 * Leads are counted per COHORT: sessions first seen in the window, converted
 * at any time since, so the newest days have had the least time to convert.
 */
export interface ChannelAttribution {
  sessions: number
  leads: number
}

export interface CriticInputs {
  weekOf: string
  seoMemos: unknown[]
  adsMemos: unknown[]
  socialMemos: unknown[]
  /** Keyed by first-touch channel (see `channelOf`). */
  attribution: Record<string, ChannelAttribution>
  /** Every channel together: sessions in the window, and how many became a lead. */
  funnel: { sessions: number; leads: number }
  priorSignals: unknown[]
  voiceFlags: unknown[]
}

export function isoWeekOf(d = new Date()): string {
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

/** The columns the attribution read names, all of which exist (00101, 00211). */
const ATTRIBUTION_COLUMNS = "session_id, gclid, gbraid, wbraid, fbclid, utm_source, referrer, claimed_at"

/**
 * PostgREST answers at most max-rows (1000 by default) per request, without
 * an error. The attribution and funnel reads are paged with `.range()` so the
 * counts cannot come back short in silence.
 */
const PAGE_SIZE = 1000

export interface AttributionRow {
  session_id: string
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
  utm_source: string | null
  referrer: string | null
  claimed_at: string | null
}

/**
 * The channel a session FIRST arrived through. A paid click id outranks a UTM
 * tag, because an ad click carries both and the click id is the one the ad
 * platform set; then the UTM source as tagged; then any referrer; then
 * direct.
 */
export function channelOf(row: AttributionRow): string {
  if (row.gclid || row.gbraid || row.wbraid) return "google_ads"
  if (row.fbclid) return "meta_ads"
  const source = row.utm_source?.trim().toLowerCase()
  if (source) return source
  if (row.referrer?.trim()) return "referral"
  return "direct"
}

/** Claimed, or a funnel form was submitted from it. See the header. */
function isLead(row: AttributionRow, funnelSessions: ReadonlySet<string>): boolean {
  return Boolean(row.claimed_at) || funnelSessions.has(row.session_id)
}

export function aggregateAttribution(
  rows: AttributionRow[],
  funnelSessions: ReadonlySet<string>,
): Record<string, ChannelAttribution> {
  const out: Record<string, ChannelAttribution> = {}
  for (const row of rows) {
    const channel = channelOf(row)
    const entry = (out[channel] ??= { sessions: 0, leads: 0 })
    entry.sessions += 1
    if (isLead(row, funnelSessions)) entry.leads += 1
  }
  return out
}

export function aggregateFunnel(rows: AttributionRow[], funnelSessions: ReadonlySet<string>): CriticInputs["funnel"] {
  return { sessions: rows.length, leads: rows.filter((row) => isLead(row, funnelSessions)).length }
}

/**
 * A read the critic depends on, or a thrown error that names it. G41: an error
 * is not an empty list. Turned into one, a failed read reads to the model as
 * "nothing happened this month", and the signal it writes says so.
 */
function rowsOf<T>(label: string, res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(`[critic-signals] could not read ${label}: ${res.error.message}`)
  return (res.data as T[] | null) ?? []
}

/** Every page of a read, each checked with `rowsOf`. Stops at the first short page. */
async function allPages<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = rowsOf<T>(label, await page(from, from + PAGE_SIZE - 1))
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

export async function gatherCriticInputs(supabase: SupabaseClient): Promise<CriticInputs> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [seoRes, adsRes, socialRes, attrRows, funnelRows, signalRes, voiceRes] = await Promise.all([
    supabase.from("seo_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("google_ads_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("social_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    // Sessions that ARRIVED in the window. No tenant predicate, because the
    // table has no business_id (ledger G42, an owner decision): this counts
    // every business's sessions, like the memo reads beside it. Ordered by id
    // so the pages do not overlap or skip.
    allPages<AttributionRow>("marketing_attribution", (from, to) =>
      supabase
        .from("marketing_attribution")
        .select(ATTRIBUTION_COLUMNS)
        .gte("first_seen_at", cutoff)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Funnel-form leads, which are linked to their session here and never
    // claimed. A submission from a window session can only be newer than the
    // cutoff, so the same cutoff bounds the read. NO business predicate,
    // deliberately, though this table has one (00278): it is only ever joined
    // to the untenanted sessions above by session id, so scoping this side
    // alone would change nothing. It scopes when G42 gives
    // marketing_attribution a business (an owner decision).
    allPages<{ attribution_session_id: string }>("funnel_submissions", (from, to) =>
      supabase
        .from("funnel_submissions")
        .select("attribution_session_id")
        .gte("created_at", cutoff)
        .not("attribution_session_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("cross_channel_signals").select("*").order("created_at", { ascending: false }).limit(SIGNAL_LOOKBACK),
    supabase.from("voice_drift_flags").select("*").gte("created_at", cutoff),
  ])
  const funnelSessions = new Set(funnelRows.map((row) => row.attribution_session_id))
  return {
    weekOf: isoWeekOf(),
    seoMemos: rowsOf("seo_agent_memos", seoRes),
    adsMemos: rowsOf("google_ads_agent_memos", adsRes),
    socialMemos: rowsOf("social_agent_memos", socialRes),
    attribution: aggregateAttribution(attrRows, funnelSessions),
    funnel: aggregateFunnel(attrRows, funnelSessions),
    priorSignals: rowsOf("cross_channel_signals", signalRes),
    voiceFlags: rowsOf("voice_drift_flags", voiceRes),
  }
}

export interface PreflightSummary {
  ok: boolean
  reasons: string[]
  channelMemoCounts: { seo: number; ads: number; social: number }
}

export function criticPreflight(inputs: CriticInputs): PreflightSummary {
  const counts = {
    seo: inputs.seoMemos.length,
    ads: inputs.adsMemos.length,
    social: inputs.socialMemos.length,
  }
  const channelsWithMemos = Object.values(counts).filter((n) => n > 0).length
  if (channelsWithMemos < MIN_CHANNELS_WITH_MEMO) {
    return {
      ok: false,
      reasons: [
        `Only ${channelsWithMemos} channel(s) have memos in the last ${LOOKBACK_DAYS}d (need ${MIN_CHANNELS_WITH_MEMO}).`,
      ],
      channelMemoCounts: counts,
    }
  }
  return { ok: true, reasons: [], channelMemoCounts: counts }
}
