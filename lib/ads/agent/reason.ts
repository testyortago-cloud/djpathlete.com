// lib/ads/agent/reason.ts
// Single Claude call with cached system prompt. Validates the response
// against adsAgentDecisionSchema; retries once on validation failure.

import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
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

export async function reasonAdsDecision(
  signals: AdsSignals,
): Promise<ReasonAdsDecisionResult> {
  const snapshot = JSON.stringify(signals)
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const userMessage =
      attempt === 0
        ? snapshot
        : `${snapshot}\n\nYour previous response did not match the schema. Return ONLY valid JSON matching adsAgentDecisionSchema.`

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
