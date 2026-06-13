// lib/ads/agent/reason.ts
// Single Claude call with cached system prompt. Validates the response
// against adsAgentDecisionSchema; retries once on validation failure.

import { z } from "zod"
import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import { fewShotsBlock } from "@/lib/agents/few-shots"
import { adsAgentDecisionSchema, type AdsAgentDecision } from "./decision-schema"
import type { AdsSignals } from "./types"

const SYSTEM_PROMPT = `You are the senior paid-media strategist for DJP Athlete.
Tone: direct, opinionated, pragmatic — like a coach talking to another coach,
not an engineer.

Audience for rationale + watch_list + supporting_signals text: the BUSINESS
OWNER reading this memo is not technical. They run coaching, not ads.

WRITE FOR THEM. Banned words (use the plain-language alternative):
  - "preflight"          → "the assistant's safety checks"
  - "GSC" / "Search Console" lag → "your Google search data isn't fresh yet"
  - "conversion tracking is stale" → "Google Ads can't see who bought yet"
  - "impression share"   → "how often your ad showed up"
  - "CTR / CVR / CAC / ROAS" → write the plain version: "click rate /
                              sign-up rate / cost per customer / return"
  - "attribution"        → "tracking which ad earned the sale"
  - "sync lag"           → "data is X hours behind"
  - "API / cron / pipeline" → don't reference internal systems at all
  - "audit / audit log"  → "history" or "review"
The supporting_signals array can still use the raw signal names (those are
for the system, not the reader) — but rationale and watch_list strings must
be readable by a non-technical user.

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
- COLD-START EXCEPTION: when raw.campaigns is empty or all campaigns are
  PAUSED/REMOVED, "fix tracking first" is the WRONG instinct — the account
  has zero data because it has zero spend. Propose UP TO TWO starter
  campaigns: ONE lead-gen (conversion_type='lead' inventory) AND ONE
  purchase (conversion_type='purchase' inventory). Lead-gen feeds the CRM
  funnel; purchase tests direct conversion. Don't propose more than two
  starters — past that, give the first two time to produce data.
- Cold-start picking order:
    1. Lead-gen: performance_assessment (free top-of-funnel) > online_coaching
       > in_person_coaching > clinics/camps if in_window.
    2. Purchase: rotational_reboot (only purchase product today).
  Pick the lead-gen item that most overlaps with organic activity in
  gsc_organic_top10; tie-break by alphabetical order of slug.
- Steady state (>=1 active campaign): use propose_new_campaign at most ONCE.
- Pin every proposal to an inventory item. Set "inventory_ref" in args to the
  product slug (kind='product') or event id (kind='event'). Do NOT propose a
  campaign with no inventory_ref — the human reviewer can't act on a vague
  blueprint.
- Lead-gen products (conversion_type='lead') drive form submissions, NOT
  purchases. Set conversion_goal='form_submission_lead', use lead-magnet ad
  copy ("Free assessment", "Talk to a coach", "Get a custom plan", "Book a
  call"), and pick campaign_type='SEARCH' over PMAX/DISPLAY by default —
  lead intent is best captured on search.
- CHARACTER LIMITS ARE HARD. Count syllables, not vibes:
    Headlines: <= 30 chars each. Aim for 24-28 so there's slack.
    Descriptions: <= 90 chars each. Aim for 78-86. Examples that fit:
      "Talk to a coach. Build a plan that fits your sport and schedule." (62)
      "6-week rotational power program. Built by PhD coach. Online." (61)
      "Free return-to-sport assessment. Tampa Bay & remote." (54)
    If a draft is 91+ chars, end the sentence sooner — don't trail off.
- For event inventory, respect the paid_window_state field:
    in_window     → propose_new_campaign is appropriate
    closing_soon  → only if confidence is high AND budget is small ($5-10/day)
    too_early     → wait; propose flag_for_human "next event planning"
    too_late      → do NOT propose paid; flag_for_human with "next cycle"
                    framing, and consider propose_negative_keywords for
                    past-event terms.
  paid_window_open_days_before / paid_window_close_days_before give the bounds.
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
    (signals.promotable_inventory ?? []).length > 0
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

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n")
}

export async function reasonAdsDecision(
  signals: AdsSignals,
  opts: { critique_objections?: string[] } = {},
): Promise<ReasonAdsDecisionResult> {
  const baseUserMessage = buildAdsReasonUserMessage(signals, {
    critique_objections: opts.critique_objections,
  })
  let lastError: z.ZodError | unknown = null

  let lastErrorMessage: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    let userMessage = baseUserMessage
    if (attempt === 1 && lastError instanceof z.ZodError) {
      userMessage = `${baseUserMessage}

Your previous response failed schema validation. Fix THESE specific issues and re-emit the full decision (do not omit other actions, just fix these fields):
${formatZodIssues(lastError)}

Hard reminders:
- Headline strings: <= 30 characters each. If your draft is 31, drop a word.
- Description strings: <= 90 characters each. If 91+, end the sentence sooner.
- keyword_themes: at least 1, max 5 themes; each with >= 2 keywords.
- supporting_gaql_evidence: at least 1 row with non-empty gaql AND finding.`
    } else if (attempt === 1 && lastErrorMessage) {
      userMessage = `${baseUserMessage}

Your previous response could not be parsed. Reason: ${lastErrorMessage}
Return ONLY valid JSON matching the schema.`
    }

    let response
    try {
      response = await callAgent(
        SYSTEM_PROMPT,
        userMessage,
        adsAgentDecisionSchema,
        {
          model: MODEL_SONNET,
          cacheSystemPrompt: true,
        },
      )
    } catch (err) {
      // generateObject throws AI_NoObjectGeneratedError when the model
      // output fails the Zod schema (including the superRefine on
      // propose_new_campaign.args). Pull out the Zod cause if present so
      // the next attempt gets specific feedback. Log the chain so the
      // dev console shows what the model actually returned and why it
      // failed — without this, both retries get the same opaque message.
      const errObj = err as { cause?: unknown; text?: string; response?: unknown }
      const cause = errObj?.cause
      console.error(
        `[reasonAdsDecision] attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : String(err),
      )
      if (cause instanceof z.ZodError) {
        console.error("[reasonAdsDecision] Zod issues:", JSON.stringify(cause.issues, null, 2))
        lastError = cause
      } else {
        if (cause) {
          console.error("[reasonAdsDecision] non-Zod cause:", cause)
        }
        if (typeof errObj.text === "string") {
          console.error(
            `[reasonAdsDecision] model text (${errObj.text.length} chars):`,
            errObj.text.slice(0, 3000),
          )
        }
        lastError = null
        lastErrorMessage = err instanceof Error ? err.message : String(err)
      }
      continue
    }

    const parsed = adsAgentDecisionSchema.safeParse(response.content)
    if (parsed.success) {
      return {
        decision: parsed.data,
        tokensUsed: response.tokens_used ?? 0,
      }
    }
    lastError = parsed.error
  }

  const detail = lastError instanceof z.ZodError ? formatZodIssues(lastError) : lastErrorMessage
  throw new Error(`Ads agent decision invalid after retry:\n${detail ?? "unknown"}`)
}
