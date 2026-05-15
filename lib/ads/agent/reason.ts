// lib/ads/agent/reason.ts
// Single Claude call with cached system prompt. Validates the response
// against adsAgentDecisionSchema; retries once on validation failure.

import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import { fewShotsBlock } from "@/lib/agents/few-shots"
import { adsAgentDecisionSchema, type AdsAgentDecision } from "./decision-schema"
import type { AdsSignals } from "./types"

const SYSTEM_PROMPT = `You are the senior paid-media strategist for DJP Athlete.
Programs include "Comeback Code" and "Rotational Reboot". Tone: direct,
opinionated, pragmatic.

You will receive a JSON snapshot of the account's marketing state:
- raw inputs (campaigns, search terms, GA4, GSC, pipeline)
- cross-channel derived signals (paid-terms-already-organic, organic-wins-not-in-ads, landing-page-engagement-mismatch)
- a learning layer (prior_actions_that_worked / prior_actions_that_failed from past memos)

Your job is to produce a Zod-validated decision with up to 7 ranked actions.

Calibrated confidence (be honest, not optimistic):
  10 = identical pattern to recent measured wins, strong signal
   7 = clean reasoning, partial historical match
   4 = weak signal or ambiguous; best available action but uncertain
   1 = high uncertainty; would prefer to flag_for_human

If your plan deviates from the brief's themes/keywords_to_chase/hooks_to_test,
set dissent_from_upstream.dissents=true and explain in one sentence. Honest dissent
beats silent override.

Rules you MUST follow:
- Bias toward repeating patterns in prior_actions_that_worked.
- Avoid repeating patterns in prior_actions_that_failed.
- Cite specific signals in supporting_signals (use the signal names from the snapshot).
- Use flag_for_human when signals are ambiguous or when no tool fits.
- Use propose_new_campaign sparingly — at most one per memo, and only when
  organic_wins_not_in_ads shows a cluster the account has zero paid presence on.
- When data is sparse (gaps[] is non-empty), mark confidence as 'low'.
- All actions are PROPOSALS routed to a human-approved queue. Phrase rationale
  as a recommendation, not a fait accompli.

Return only the structured decision — no narrative text outside the schema.`

export interface ReasonAdsDecisionResult {
  decision: AdsAgentDecision
  tokensUsed: number
}

export interface BuildAdsReasonUserMessageOpts {
  critique_objections?: string[]
}

/**
 * Pure assembly of the user message Claude sees. Extracted so the prompt
 * shape can be unit-tested without invoking the Anthropic SDK.
 */
export function buildAdsReasonUserMessage(
  signals: AdsSignals,
  opts: BuildAdsReasonUserMessageOpts = {},
): string {
  const briefBlock = signals.brief_context
    ? [
        "Brief context (bias your action ranking toward themes + keywords; treat dont_do as hard guardrail):",
        JSON.stringify(signals.brief_context, null, 2),
        "",
        "If you align well with the brief, set brief_alignment_score 7-10. If you deviate (with reason), 4-6. Ignoring the brief entirely is 1-3.",
        "",
      ].join("\n")
    : "(No approved brief this week — reason freely. Set brief_alignment_score to null.)\n"

  const toolPerfBlock =
    signals.tool_performance.length > 0
      ? [
          "Tool performance (last 90 days, your channel):",
          ...signals.tool_performance.map(
            (t) =>
              `  ${t.tool}: avg impact ${t.avg_impact_score >= 0 ? "+" : ""}${t.avg_impact_score}, ${t.n_measured} runs, ${Math.round(t.success_rate * 100)}% success`,
          ),
          "",
          "Bias your ranking toward tools with positive avg_impact and >50% success unless the signal strongly indicates otherwise. If you choose a historically weak tool, lower your agent_confidence and explain in rationale.",
          "",
        ].join("\n")
      : ""

  const critiqueBlock =
    opts.critique_objections && opts.critique_objections.length > 0
      ? [
          "A second model raised these objections to your prior plan:",
          ...opts.critique_objections.map((o) => `  - ${o}`),
          "",
          "Reconsider. You may keep the plan with stronger justification, or revise it. Output the same schema as before.",
          "",
        ].join("\n")
      : ""

  const fewShotsRendered = fewShotsBlock(signals.few_shots ?? [])

  const snapshot = JSON.stringify(signals)
  return `${briefBlock}${toolPerfBlock}${fewShotsRendered}${critiqueBlock}\n${snapshot}`
}

export async function reasonAdsDecision(
  signals: AdsSignals,
  opts: { critique_objections?: string[] } = {},
): Promise<ReasonAdsDecisionResult> {
  const baseUserMessage = buildAdsReasonUserMessage(signals, {
    critique_objections: opts.critique_objections,
  })
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const userMessage =
      attempt === 0
        ? baseUserMessage
        : `${baseUserMessage}\n\nYour previous response did not match the schema. Return ONLY valid JSON matching adsAgentDecisionSchema.`

    const response = await callAgent(
      SYSTEM_PROMPT,
      userMessage,
      adsAgentDecisionSchema,
      {
        model: MODEL_SONNET,
        cacheSystemPrompt: true,
      },
    )

    const parsed = adsAgentDecisionSchema.safeParse(response.content)
    if (parsed.success) {
      return {
        decision: parsed.data,
        tokensUsed: response.tokens_used ?? 0,
      }
    }
    lastError = parsed.error
  }

  throw new Error(`Ads agent decision invalid after retry: ${String(lastError)}`)
}
