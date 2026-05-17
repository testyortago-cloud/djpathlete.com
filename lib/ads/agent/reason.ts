// lib/ads/agent/reason.ts
// Single Claude call with cached system prompt. Validates the response
// against adsAgentDecisionSchema; retries once on validation failure.

import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import { fewShotsBlock } from "@/lib/agents/few-shots"
import { adsAgentDecisionSchema, type AdsAgentDecision } from "./decision-schema"
import type { AdsSignals } from "./types"

const SYSTEM_PROMPT = `You are the senior paid-media strategist for DJP Athlete.
Tone: direct, opinionated, pragmatic.

You will receive a JSON snapshot of the account's marketing state:
- raw inputs (campaigns, search terms, GA4, GSC, pipeline)
- cross-channel derived signals (paid-terms-already-organic, organic-wins-not-in-ads, landing-page-engagement-mismatch)
- a learning layer (prior_actions_that_worked / prior_actions_that_failed from past memos)
- promotable_inventory — always-on programs and specific upcoming clinic/camp events
  the business can run campaigns for. Each item has signature_phrases (seed keywords),
  pain_points (ad-copy fuel), landing_url, geo_focus, conversion_type, and event-only
  fields (event_start_date, days_until_event, spots_remaining, age_range, location_name).

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
- When data is sparse (gaps[] is non-empty), mark confidence as 'low'.
- All actions are PROPOSALS routed to a human-approved queue. Phrase rationale
  as a recommendation, not a fait accompli.

propose_new_campaign rules:
- Use sparingly — at most one per memo.
- Pin every proposal to an inventory item. Set "inventory_ref" in args to the
  product slug (kind='product') or event id (kind='event'). Do NOT propose a
  campaign with no inventory_ref — the human reviewer can't act on a vague
  blueprint.
- Prefer event inventory when days_until_event >= 7 (otherwise too late for
  paid acquisition to compound; instead propose flag_for_human "next clinic
  pipeline" or propose_negative_keywords for past-event terms).
- Derive keyword_themes from the inventory item's signature_phrases. Add
  match types thoughtfully — EXACT for brand/explicit intent, PHRASE for
  themed clusters, BROAD only when learning has shown the account converts
  on broad.
- Use the inventory item's geo_focus verbatim for online products (ISO
  codes). For local events (kind='event'), set geo_target to the city/region
  parsed from location_name plus a 25-mile radius.
- Required args shape (fill all fields; the executor enforces this):
    {
      "inventory_ref": "<slug or event uuid>",
      "inventory_kind": "product" | "event",
      "campaign_type": "SEARCH" | "PMAX" | "DISPLAY",
      "campaign_name": "<product/event> - <type> - <theme>",
      "daily_budget_cents": <number 500..5000 unless prior wins justify more>,
      "geo_targets": ["<ISO or city,region>", ...],
      "keyword_themes": [
        { "theme": "<short>", "match_type": "EXACT|PHRASE|BROAD",
          "keywords": ["<3+ items>"] }
      ],
      "negative_seed": ["free","youtube","cheap","reddit"],
      "ad_copy": {
        "headlines": ["<<=30 chars>", ... 3..15 items],
        "descriptions": ["<<=90 chars>", ... 2..4 items],
        "final_url": "<absolute or path>"
      },
      "conversion_goal": "form_submission_lead" | "purchase" | "booking",
      "supporting_gaql_evidence": [
        { "gaql": "SELECT ... FROM search_term_view WHERE ...",
          "finding": "<one-line summary of what this query proves>" }
      ]
    }
- supporting_gaql_evidence must reference real queries you'd run against the
  Google Ads or GSC APIs. Tie each finding to a concrete number from the
  snapshot (e.g. "organic_wins_not_in_ads has 'rotational power' at #4 with
  187 clicks/28d, zero paid coverage").

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

  const inventoryBlock =
    signals.promotable_inventory.length > 0
      ? [
          "Promotable inventory (programs + upcoming events the agent can build campaigns for):",
          JSON.stringify(signals.promotable_inventory, null, 2),
          "",
          "When picking propose_new_campaign, the inventory_ref MUST match a 'ref' in the list above (product slug or event id). Skip inventory whose conversion_type doesn't match the action you're proposing (e.g. don't drive purchase ads at a 'lead' product).",
          "",
        ].join("\n")
      : ""

  const snapshot = JSON.stringify(signals)
  return `${briefBlock}${toolPerfBlock}${inventoryBlock}${fewShotsRendered}${critiqueBlock}\n${snapshot}`
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
