// Sunday cron handler. Reads most recent signal + last 4 briefs, asks Claude
// for a draft brief, inserts with approval_status='draft'. Skips silently if
// no fresh signal exists.

import { z } from "zod"
import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import {
  CHIEF_SYSTEM_PROMPT,
  buildChiefUserMessage,
  type CrossChannelSignal,
  type StrategyBrief,
} from "./strategy/chief-prompt.js"

// Inlined StrategyBrief Zod schema. Source of truth lives in
// lib/strategy/specialist-contract.ts; mirrored here because functions/
// tsconfig has rootDir: "src" and cannot import outside it.
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
})

const SIGNAL_MAX_AGE_DAYS = 8
const PRIOR_BRIEFS_LOOKBACK = 4

export type ChiefOutcome = "draft_created" | "no_signal" | "stale_signal" | "error"

export interface ChiefStrategistResult {
  outcome: ChiefOutcome
  briefId?: string
  signalId?: string
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
  const { content } = await callAgent(
    CHIEF_SYSTEM_PROMPT,
    buildChiefUserMessage({ weekOf, latestSignal: signal, priorBriefs }),
    StrategyBriefSchema,
    { model: MODEL_SONNET, maxTokens: 3000, cacheSystemPrompt: true },
  )

  const { data, error } = await supabase
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
  if (error) {
    console.error("[chief-strategist] insert error", error)
    return { outcome: "error", signalId: signal.id }
  }
  console.log(`[chief-strategist] wrote draft brief ${data?.id} for week ${content.week_of}`)
  return { outcome: "draft_created", briefId: data?.id, signalId: signal.id }
}
