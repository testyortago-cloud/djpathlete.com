import type { SupabaseClient } from "@supabase/supabase-js"

const LOOKBACK_DAYS = 28
const SIGNAL_LOOKBACK = 4
const MIN_CHANNELS_WITH_MEMO = 2

export interface CriticInputs {
  weekOf: string
  seoMemos: unknown[]
  adsMemos: unknown[]
  socialMemos: unknown[]
  attribution: Record<string, { bookings: number; revenue?: number; sessions?: number }>
  funnel: { visits: number; signups: number; bookings: number; payments: number }
  priorSignals: unknown[]
  voiceFlags: unknown[]
}

function isoWeekOf(d = new Date()): string {
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

interface AttrRow {
  channel: string | null
  event_type: string | null
  revenue_cents?: number | null
}

function aggregateAttribution(rows: AttrRow[]) {
  const out: CriticInputs["attribution"] = {}
  for (const r of rows) {
    const c = r.channel ?? "unknown"
    if (!out[c]) out[c] = { bookings: 0, revenue: 0, sessions: 0 }
    if (r.event_type === "booking") out[c].bookings += 1
    if (r.event_type === "payment") out[c].revenue = (out[c].revenue ?? 0) + (r.revenue_cents ?? 0) / 100
    if (r.event_type === "session") out[c].sessions = (out[c].sessions ?? 0) + 1
  }
  return out
}

function aggregateFunnel(rows: AttrRow[]) {
  const f = { visits: 0, signups: 0, bookings: 0, payments: 0 }
  for (const r of rows) {
    if (r.event_type === "visit") f.visits += 1
    else if (r.event_type === "signup") f.signups += 1
    else if (r.event_type === "booking") f.bookings += 1
    else if (r.event_type === "payment") f.payments += 1
  }
  return f
}

export async function gatherCriticInputs(supabase: SupabaseClient): Promise<CriticInputs> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [seoRes, adsRes, socialRes, attrRes, signalRes, voiceRes] = await Promise.all([
    supabase.from("seo_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("google_ads_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("social_agent_memos").select("*").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supabase.from("marketing_attribution").select("*").gte("occurred_at", cutoff),
    supabase.from("cross_channel_signals").select("*").order("created_at", { ascending: false }).limit(SIGNAL_LOOKBACK),
    supabase.from("voice_drift_flags").select("*").gte("created_at", cutoff),
  ])
  const attrRows = (attrRes.data as AttrRow[] | null) ?? []
  return {
    weekOf: isoWeekOf(),
    seoMemos: (seoRes.data as unknown[]) ?? [],
    adsMemos: (adsRes.data as unknown[]) ?? [],
    socialMemos: (socialRes.data as unknown[]) ?? [],
    attribution: aggregateAttribution(attrRows),
    funnel: aggregateFunnel(attrRows),
    priorSignals: (signalRes.data as unknown[]) ?? [],
    voiceFlags: (voiceRes.data as unknown[]) ?? [],
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
