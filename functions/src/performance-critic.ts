// Saturday cron handler. Reads last 4 weeks of memos + attribution + funnel,
// writes one cross_channel_signals row. No-ops if preflight fails.

import { z } from "zod"
import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { gatherCriticInputs, criticPreflight, isoWeekOf } from "./strategy/critic-signals.js"
import { CRITIC_SYSTEM_PROMPT, buildCriticUserMessage } from "./strategy/critic-prompt.js"

const CriticOutputSchema = z.object({
  winners: z.array(
    z.object({
      channel: z.enum(["seo", "ads", "social"]),
      what: z.string(),
      evidence: z.string(),
    }),
  ),
  losers: z.array(z.object({ channel: z.string(), what: z.string(), evidence: z.string() })),
  anomalies: z.array(z.object({ what: z.string(), evidence: z.string() })),
  attribution_summary: z.record(z.string(), z.unknown()),
  recommendations_for_brief: z.array(z.string()),
  rationale: z.string().min(1),
})

export type CriticOutcome = "ok" | "preflight_failed" | "error"

export interface PerformanceCriticResult {
  outcome: CriticOutcome
  signalId?: string
  reasons?: string[]
}

export async function runPerformanceCritic(): Promise<PerformanceCriticResult> {
  const supabase = getSupabase()

  /** A signal row that says "no read this week", which the Chief treats as stale_signal. */
  const writeFailedSignal = async (weekOf: string, reasons: string[], rationale: string) => {
    const { data, error } = await supabase
      .from("cross_channel_signals")
      .insert({
        week_of: weekOf,
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: [],
        preflight_status: "failed",
        preflight_reasons: reasons,
        rationale,
      })
      .select("id")
      .single()
    if (error) console.error("[performance-critic] failed-signal insert error", error)
    return data?.id as string | undefined
  }

  // G41. A read the critic depends on failing is an ERROR outcome, and it
  // writes a FAILED signal carrying the reason, never a normal one: a signal
  // built on a failed read says "nothing happened". And never no row at all:
  // the Chief Strategist runs the next morning, and with no new row it takes
  // last week's signal, which is still inside its 8-day window.
  let inputs: Awaited<ReturnType<typeof gatherCriticInputs>>
  try {
    inputs = await gatherCriticInputs(supabase)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error("[performance-critic] could not gather inputs; writing a failed signal:", reason)
    const signalId = await writeFailedSignal(isoWeekOf(), [reason], `Inputs could not be read: ${reason}`)
    return { outcome: "error", signalId, reasons: [reason] }
  }
  const preflight = criticPreflight(inputs)

  if (!preflight.ok) {
    const signalId = await writeFailedSignal(
      inputs.weekOf,
      preflight.reasons,
      `Preflight failed: ${preflight.reasons.join("; ")}`,
    )
    return { outcome: "preflight_failed", signalId, reasons: preflight.reasons }
  }

  const { content } = await callAgent(
    CRITIC_SYSTEM_PROMPT,
    buildCriticUserMessage(inputs),
    CriticOutputSchema,
    { model: MODEL_SONNET, maxTokens: 3000, cacheSystemPrompt: true },
  )

  const { data, error } = await supabase
    .from("cross_channel_signals")
    .insert({
      week_of: inputs.weekOf,
      winners: content.winners,
      losers: content.losers,
      anomalies: content.anomalies,
      attribution_summary: content.attribution_summary,
      recommendations_for_brief: content.recommendations_for_brief,
      preflight_status: "ok",
      preflight_reasons: [],
      rationale: content.rationale,
    })
    .select("id")
    .single()
  if (error) {
    console.error("[performance-critic] signal insert error", error)
    return { outcome: "error" }
  }
  console.log(`[performance-critic] wrote signal ${data?.id} for week ${inputs.weekOf}`)
  return { outcome: "ok", signalId: data?.id }
}
