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

function isoWeekOf(d = new Date()): string {
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

/** The columns the attribution read names, all of which exist (00101, 00211). */
const ATTRIBUTION_COLUMNS = "gclid, gbraid, wbraid, fbclid, utm_source, referrer, claimed_at"

export interface AttributionRow {
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

export function aggregateAttribution(rows: AttributionRow[]): Record<string, ChannelAttribution> {
  const out: Record<string, ChannelAttribution> = {}
  for (const row of rows) {
    const channel = channelOf(row)
    const entry = (out[channel] ??= { sessions: 0, leads: 0 })
    entry.sessions += 1
    if (row.claimed_at) entry.leads += 1
  }
  return out
}

export function aggregateFunnel(rows: AttributionRow[]): CriticInputs["funnel"] {
  return { sessions: rows.length, leads: rows.filter((row) => row.claimed_at).length }
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

export async function gatherCriticInputs(supabase: SupabaseClient): Promise<CriticInputs> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [seoRes, adsRes, socialRes, attrRes, signalRes, voiceRes] = await Promise.all([
    supabase.from("seo_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("google_ads_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("social_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    // Sessions that ARRIVED in the window. No tenant predicate, because the
    // table has no business_id (ledger G42, an owner decision): this counts
    // every business's sessions, like the memo reads beside it.
    supabase.from("marketing_attribution").select(ATTRIBUTION_COLUMNS).gte("first_seen_at", cutoff),
    supabase.from("cross_channel_signals").select("*").order("created_at", { ascending: false }).limit(SIGNAL_LOOKBACK),
    supabase.from("voice_drift_flags").select("*").gte("created_at", cutoff),
  ])
  const attrRows = rowsOf<AttributionRow>("marketing_attribution", attrRes)
  return {
    weekOf: isoWeekOf(),
    seoMemos: rowsOf("seo_agent_memos", seoRes),
    adsMemos: rowsOf("google_ads_agent_memos", adsRes),
    socialMemos: rowsOf("social_agent_memos", socialRes),
    attribution: aggregateAttribution(attrRows),
    funnel: aggregateFunnel(attrRows),
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
