// Sunday cron handler. Reads most recent signal + last 4 briefs, asks Claude
// for a draft brief, inserts with approval_status='draft'. Skips silently if
// no fresh signal exists.

import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import {
  CHIEF_SYSTEM_PROMPT,
  buildChiefUserMessage,
  type ChiefToolPerfPerChannel,
  type CrossChannelSignal,
  type StrategyBrief,
} from "./strategy/chief-prompt.js"

// Inlined StrategyBrief Zod schema. Source of truth lives in
// lib/strategy/specialist-contract.ts; mirrored here because functions/
// tsconfig has rootDir: "src" and cannot import outside it.
const ChiefMemoPayloadSchema = z.object({
  themes_considered: z.array(
    z.object({
      tag: z.string().min(1),
      weight: z.number().min(0).max(1),
      accepted: z.boolean(),
      reason: z.string().min(1),
    }),
  ),
  channels_considered: z.array(
    z.object({
      channel: z.enum(["seo", "ads", "social", "balanced"]),
      score: z.number().min(0).max(10),
      accepted: z.boolean(),
    }),
  ),
  confidence: z.number().int().min(1).max(10),
  dissents_from_critic: z.boolean(),
  dissent_reason: z.string().nullable(),
})

const StrategyBriefSchema = z.object({
  week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  themes: z.array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1) })),
  audience_focus: z.string().min(1),
  priority_channel: z.enum(["seo", "ads", "social", "balanced"]),
  keywords_to_chase: z.array(z.string()),
  hooks_to_test: z.array(z.string()),
  ctas: z.array(z.string()),
  dont_do: z.array(z.string()),
  rationale: z.string().min(1),
  chief_memo: ChiefMemoPayloadSchema,
})

const SIGNAL_MAX_AGE_DAYS = 8
const PRIOR_BRIEFS_LOOKBACK = 4

export type ChiefOutcome = "draft_created" | "no_signal" | "stale_signal" | "error"

export interface ChiefStrategistResult {
  outcome: ChiefOutcome
  briefId?: string
  signalId?: string
}

async function gatherChiefToolPerformance(
  supabase: SupabaseClient,
): Promise<ChiefToolPerfPerChannel> {
  const { data: baselines } = await supabase
    .from("agent_tool_baselines")
    .select("channel, tool_name, n_measured, success_rate")
  const byChannel: ChiefToolPerfPerChannel = { seo: [], ads: [], social: [] }
  if (!baselines) return byChannel

  // For avg_impact_score we'd need to join with memos per channel; for
  // simplicity at the Chief level we omit it (the Chief doesn't need per-tool
  // precision — it needs to know which channel is producing wins). Use 0 if
  // we don't have it readily available. success_rate + n_measured is
  // sufficient signal for the Chief's priority_channel decision.
  for (const b of baselines as Array<{
    channel: "seo" | "ads" | "social"
    tool_name: string
    n_measured: number
    success_rate: number
  }>) {
    if (!byChannel[b.channel]) continue
    byChannel[b.channel].push({
      tool: b.tool_name,
      n_measured: b.n_measured,
      avg_impact_score: 0,
      success_rate: b.success_rate,
    })
  }
  return byChannel
}

function nextMondayUTC(d = new Date()): string {
  const day = d.getUTCDay()
  const offset = day === 0 ? 1 : 8 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset))
  return monday.toISOString().slice(0, 10)
}

export async function runChiefStrategist(): Promise<ChiefStrategistResult> {
  const supabase = getSupabase()

  const { data: signalRow } = await supabase
    .from("cross_channel_signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const signal = signalRow as CrossChannelSignal | null
  if (!signal) {
    console.log("[chief-strategist] no signal row — skipping")
    return { outcome: "no_signal" }
  }

  const ageMs = Date.now() - new Date(signal.created_at).getTime()
  if (ageMs > SIGNAL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    console.log(`[chief-strategist] signal too old (${(ageMs / 86_400_000).toFixed(1)}d)`)
    return { outcome: "stale_signal", signalId: signal.id }
  }
  if (signal.preflight_status === "failed") {
    console.log("[chief-strategist] latest signal is preflight_failed")
    return { outcome: "stale_signal", signalId: signal.id }
  }

  const { data: priorRows } = await supabase
    .from("strategy_briefs")
    .select("*")
    .order("week_of", { ascending: false })
    .limit(PRIOR_BRIEFS_LOOKBACK)
  const priorBriefs = (priorRows as StrategyBrief[] | null) ?? []

  const weekOf = nextMondayUTC()
  const toolPerformanceByChannel = await gatherChiefToolPerformance(supabase)
  const { content } = await callAgent(
    CHIEF_SYSTEM_PROMPT,
    buildChiefUserMessage({
      weekOf,
      latestSignal: signal,
      priorBriefs,
      toolPerformanceByChannel,
    }),
    StrategyBriefSchema,
    { model: MODEL_SONNET, maxTokens: 3000, cacheSystemPrompt: true },
  )

  const briefResult = await supabase
    .from("strategy_briefs")
    .insert({
      week_of: content.week_of,
      themes: content.themes,
      audience_focus: content.audience_focus,
      priority_channel: content.priority_channel,
      keywords_to_chase: content.keywords_to_chase,
      hooks_to_test: content.hooks_to_test,
      ctas: content.ctas,
      dont_do: content.dont_do,
      rationale: content.rationale,
      signal_id: signal.id,
      approval_status: "draft",
    })
    .select("id")
    .single()

  const briefId = briefResult.data?.id ?? null
  if (briefResult.error) {
    console.error("[chief-strategist] brief insert error", briefResult.error)
  }

  // ALWAYS write the memo, even if the brief failed. This is the audit trail.
  const memoResult = await supabase
    .from("chief_strategist_memos")
    .insert({
      brief_id: briefId,
      signal_id: signal.id,
      themes_considered: content.chief_memo.themes_considered,
      channels_considered: content.chief_memo.channels_considered,
      confidence: content.chief_memo.confidence,
      dissents_from_critic: content.chief_memo.dissents_from_critic,
      dissent_reason: content.chief_memo.dissent_reason,
      self_critique_notes: null,
      rationale: content.rationale,
    })
    .select("id")
    .single()

  if (memoResult.error) {
    console.error("[chief-strategist] memo insert error", memoResult.error)
  }

  if (!briefId) {
    return { outcome: "error", signalId: signal.id }
  }
  console.log(`[chief-strategist] wrote draft brief ${briefId} for week ${content.week_of}`)
  return { outcome: "draft_created", briefId, signalId: signal.id }
}
