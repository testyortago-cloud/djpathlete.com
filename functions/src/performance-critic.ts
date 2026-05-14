// Saturday cron handler. Reads last 4 weeks of memos + attribution + funnel,
// writes one cross_channel_signals row. No-ops if preflight fails.

import { z } from "zod"
import { getSupabase } from "./lib/supabase.js"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { gatherCriticInputs, criticPreflight } from "./strategy/critic-signals.js"
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
  const inputs = await gatherCriticInputs(supabase)
  const preflight = criticPreflight(inputs)

  if (!preflight.ok) {
    const { data, error } = await supabase
      .from("cross_channel_signals")
      .insert({
        week_of: inputs.weekOf,
        winners: [],
        losers: [],
        anomalies: [],
        attribution_summary: {},
        recommendations_for_brief: [],
        preflight_status: "failed",
        preflight_reasons: preflight.reasons,
        rationale: `Preflight failed: ${preflight.reasons.join("; ")}`,
      })
      .select("id")
      .single()
    if (error) console.error("[performance-critic] preflight insert error", error)
    return { outcome: "preflight_failed", signalId: data?.id, reasons: preflight.reasons }
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
