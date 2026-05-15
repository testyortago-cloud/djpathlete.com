// Chief Strategist prompt. Inlined CrossChannelSignal/StrategyBrief shapes
// (functions/ tsconfig has rootDir: "src" and cannot import from ../../../types).

import { fewShotsBlock } from "../lib/few-shots.js"

export interface ChiefToolPerfEntry {
  tool: string
  n_measured: number
  avg_impact_score: number
  success_rate: number
}

export interface ChiefToolPerfPerChannel {
  seo: ChiefToolPerfEntry[]
  ads: ChiefToolPerfEntry[]
  social: ChiefToolPerfEntry[]
}

export interface CrossChannelSignal {
  id: string
  week_of: string
  winners: unknown[]
  losers: unknown[]
  anomalies: unknown[]
  attribution_summary: Record<string, unknown>
  recommendations_for_brief: unknown[]
  preflight_status: "ok" | "failed"
  preflight_reasons: string[]
  rationale: string
  created_at: string
}

export interface StrategyBrief {
  id: string
  week_of: string
  themes: { tag: string; weight: number }[]
  audience_focus: string
  priority_channel: "seo" | "ads" | "social" | "balanced"
  keywords_to_chase: string[]
  hooks_to_test: string[]
  ctas: string[]
  dont_do: string[]
  rationale: string
  signal_id: string | null
  approval_status: "draft" | "approved" | "rejected"
  approved_at: string | null
  approved_by: string | null
  created_at: string
}

export const CHIEF_SYSTEM_PROMPT = `You are the Chief Strategist for the Darren J Paul Athlete brand.

Your job: produce next week's StrategyBrief — a single coordinating document the SEO, Ads, and Social agents will read. You are NOT picking specific actions; you are setting direction. Specialists keep their own action queues and approvals.

Inputs you receive:
1. The most recent cross_channel_signals row (the Critic's read of the last 4 weeks).
2. The last 4 briefs you wrote (for theme continuity — avoid week-to-week whiplash).
3. Cross-channel tool_performance (last 90 days) keyed by channel.

You will also receive cross-channel tool_performance (last 90 days). Bias priority_channel selection toward channels whose tools have positive success_rate and meaningful n_measured. If a channel is in warm-up (n_measured < 5), do not yet treat its absence of wins as a signal.

Priorities (in order):
1. Bookings + revenue, not vanity engagement. Use the signal's attribution_summary.
2. Compounding themes: themes that already worked > novel themes.
3. Avoid whiplash: keep at least one theme from last week unless the data is clear it bombed.

Return JSON only matching this exact shape. Note: you MUST include a chief_memo block recording your reasoning trail.

{
  "week_of": "<ISO date Monday of target week>",
  "themes": [{ "tag": "<kebab-case>", "weight": <0..1> }],
  "audience_focus": "<1-2 sentences>",
  "priority_channel": "seo|ads|social|balanced",
  "keywords_to_chase": ["<seed keyword>", ...],
  "hooks_to_test": ["<hook line>", ...],
  "ctas": ["<call to action>", ...],
  "dont_do": ["<hard guardrail phrase, prefer word-boundary specificity>", ...],
  "rationale": "<2-3 paragraphs explaining why>",
  "chief_memo": {
    "themes_considered": [
      { "tag": "<kebab>", "weight": <0..1>, "accepted": <bool>, "reason": "<one sentence>" }
    ],
    "channels_considered": [
      { "channel": "seo|ads|social|balanced", "score": <0..10>, "accepted": <bool> }
    ],
    "confidence": <integer 1..10>,
    "dissents_from_critic": <bool>,
    "dissent_reason": "<one sentence if dissents=true, else null>"
  }
}

Confidence rubric (be honest, not optimistic):
  10 = identical pattern to recent measured wins, strong signal
   7 = clean reasoning, partial historical match
   4 = weak signal or ambiguous; best available direction but uncertain
   1 = high uncertainty; would prefer to flag for human review

If you disagree with the Critic's recommendations_for_brief, set dissents_from_critic=true and explain.

dont_do entries should be specific phrases (e.g. "knee surgery recovery", not "pain"). Specialist agents match these as case-insensitive word-boundary substrings; broad words will over-reject.`

export interface ChiefPromptInput {
  weekOf: string
  latestSignal: CrossChannelSignal
  priorBriefs: StrategyBrief[]
  toolPerformanceByChannel: ChiefToolPerfPerChannel
  /**
   * Recent winning examples from the (global, chief_strategist) row of
   * prompt_templates. Empty when the column is null/empty. Rendered as a
   * "Recent winners" block; the chief should treat them as inspiration,
   * not templates.
   */
  fewShots?: string[]
}

export function buildChiefUserMessage(input: ChiefPromptInput): string {
  const fewShotsRendered = fewShotsBlock(input.fewShots ?? [])
  const sections = [
    `Week of: ${input.weekOf}`,
    "",
    "Latest Performance Critic signal:",
    JSON.stringify(input.latestSignal, null, 2),
    "",
    "Cross-channel tool performance (last 90 days):",
    JSON.stringify(input.toolPerformanceByChannel, null, 2),
    "",
    `Prior briefs (${input.priorBriefs.length}, most recent first):`,
    JSON.stringify(input.priorBriefs, null, 2),
    "",
  ]
  if (fewShotsRendered) {
    sections.push(fewShotsRendered)
  }
  sections.push("Return JSON only matching the StrategyBrief shape.")
  return sections.join("\n")
}
