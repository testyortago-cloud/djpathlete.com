// Sunday cron handler. Reads most recent signal + last 4 briefs, asks Claude
// for a draft brief, inserts with approval_status='draft'. Skips silently if
// no fresh signal exists.

import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { runSelfCritique, shouldReRunAfterCritique } from "./lib/self-critique.js"
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

  // Self-critique pass (Haiku second-pass). Gated by feature flag. If overall
  // is 'should_revise' AND confidence <= 7, re-run Chief once with the
  // objections appended. Notes persist on the memo regardless.
  const flagRow = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "agent_self_critique_enabled")
    .maybeSingle()
  const critiqueEnabled =
    (flagRow.data?.value as { enabled?: boolean } | null)?.enabled !== false

  let finalContent = content
  let critiqueNotes: string | null = null

  if (critiqueEnabled) {
    try {
      const planSummary = JSON.stringify({
        themes: content.themes,
        priority_channel: content.priority_channel,
        keywords_to_chase: content.keywords_to_chase,
        hooks_to_test: content.hooks_to_test,
        dont_do: content.dont_do,
        rationale: content.rationale,
      })
      const signalsSummary = JSON.stringify(signal).slice(0, 4000)
      const critique = await runSelfCritique({
        planSummary,
        signalsSummary,
        briefSummary:
          priorBriefs.length > 0
            ? `Prior week's themes: ${JSON.stringify(priorBriefs[0]?.themes ?? [])}`
            : null,
      })
      critiqueNotes = `[v1 critique] overall=${critique.overall}\nobjections: ${critique.objections.join("; ")}`

      if (shouldReRunAfterCritique(critique, content.chief_memo.confidence)) {
        const revisedUserMessage =
          buildChiefUserMessage({
            weekOf,
            latestSignal: signal,
            priorBriefs,
            toolPerformanceByChannel,
          }) +
          "\n\nA second model raised these objections to your prior plan:\n" +
          critique.objections.map((o) => `  - ${o}`).join("\n") +
          "\n\nReconsider. You may keep the plan with stronger justification, or revise it. Output the same schema as before."

        const revised = await callAgent(
          CHIEF_SYSTEM_PROMPT,
          revisedUserMessage,
          StrategyBriefSchema,
          { model: MODEL_SONNET, maxTokens: 3000, cacheSystemPrompt: true },
        )
        critiqueNotes = `[v1 themes] ${JSON.stringify(content.themes.map((t) => t.tag))}\n[critique] ${critique.objections.join("; ")}\n[v2 themes] ${JSON.stringify(revised.content.themes.map((t) => t.tag))}`
        finalContent = revised.content
        console.log(
          `[chief-strategist] critique triggered re-run (confidence=${content.chief_memo.confidence}, overall=${critique.overall})`,
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown"
      console.error(`[chief-strategist] self-critique failed: ${msg}`)
      critiqueNotes = `[v1 critique] failed: ${msg}`
    }
  }

  const briefResult = await supabase
    .from("strategy_briefs")
    .insert({
      week_of: finalContent.week_of,
      themes: finalContent.themes,
      audience_focus: finalContent.audience_focus,
      priority_channel: finalContent.priority_channel,
      keywords_to_chase: finalContent.keywords_to_chase,
      hooks_to_test: finalContent.hooks_to_test,
      ctas: finalContent.ctas,
      dont_do: finalContent.dont_do,
      rationale: finalContent.rationale,
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
      themes_considered: finalContent.chief_memo.themes_considered,
      channels_considered: finalContent.chief_memo.channels_considered,
      confidence: finalContent.chief_memo.confidence,
      dissents_from_critic: finalContent.chief_memo.dissents_from_critic,
      dissent_reason: finalContent.chief_memo.dissent_reason,
      self_critique_notes: critiqueNotes,
      rationale: finalContent.rationale,
    })
    .select("id")
    .single()

  if (memoResult.error) {
    console.error("[chief-strategist] memo insert error", memoResult.error)
  }

  if (!briefId) {
    return { outcome: "error", signalId: signal.id }
  }
  console.log(`[chief-strategist] wrote draft brief ${briefId} for week ${finalContent.week_of}`)
  return { outcome: "draft_created", briefId, signalId: signal.id }
}
