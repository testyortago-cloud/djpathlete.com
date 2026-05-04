// lib/ads/ad-copy.ts
// Generates `add_ad_variant` recommendations using the brand-voice prompt
// from prompt_templates (category 'google_ads_copy'). Output respects
// Google Ads RSA limits — 30-char headlines, 90-char descriptions —
// validated by the same Zod schema the apply path uses.
//
// Trigger surfaces:
//  - Manual: admin posts to /api/admin/ads/campaigns/[id]/generate-copy
//  - Future: Plan 1.5g AI Agent loops can call this directly

import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"
import {
  adVariantPayloadSchema,
  recommendationItemSchema,
} from "@/lib/validators/ads"
import { z } from "zod"
import { getLatestPromptByCategory } from "@/lib/db/prompt-templates"
import { listAdGroupsForCampaign } from "@/lib/db/google-ads-ad-groups"
import { listKeywordsForAdGroup } from "@/lib/db/google-ads-keywords"
import { listAdsForAdGroup } from "@/lib/db/google-ads-ads"
import { getCampaignById } from "@/lib/db/google-ads-campaigns"
import { insertRecommendations } from "@/lib/db/google-ads-recommendations"

const FALLBACK_VOICE_PROMPT = `You write Google Ads Responsive Search Ad copy
as DJP Athlete — a strength coach focused on rotational power, comeback
training, and performance development for athletes. Voice: direct,
confident, technically precise. Active voice. No hype.`

const adCopyBatchSchema = z.object({
  variants: z.array(
    z.object({
      ad_group_id: z.string().min(1),
      payload: adVariantPayloadSchema,
      reasoning: z.string().min(20).max(500),
      confidence: z.number().min(0).max(1),
    }),
  ).max(8),
})

type AdCopyBatch = z.infer<typeof adCopyBatchSchema>

interface AdGroupContext {
  ad_group_id_external: string
  name: string
  top_keywords: string[]
  existing_headlines: string[]
  existing_descriptions: string[]
}

/**
 * Generates ad copy variants for one campaign's eligible ad groups. Eligible
 * = ENABLED ad group with ≥3 keywords (gives the AI enough context to write
 * focused copy). For each, we feed the keywords + existing ad copy as
 * inspiration, then ask Claude for one new RSA variant.
 */
export interface RunAdCopyForCampaignOptions {
  /** Final URL to use for new ad variants. Defaults to https://www.darrenjpaul.com. */
  finalUrl?: string
  /** Cap how many ad groups to score per campaign run. Default 5. */
  maxAdGroups?: number
  model?: string
}

export interface RunAdCopyResult {
  ad_groups_scored: number
  ad_groups_skipped: number
  variants_generated: number
  variants_persisted: number
  tokens_used: number
}

const PROD_DEFAULT_FINAL_URL = "https://www.darrenjpaul.com"

export async function runAdCopyForCampaign(
  localCampaignId: string,
  options: RunAdCopyForCampaignOptions = {},
): Promise<RunAdCopyResult> {
  const result: RunAdCopyResult = {
    ad_groups_scored: 0,
    ad_groups_skipped: 0,
    variants_generated: 0,
    variants_persisted: 0,
    tokens_used: 0,
  }

  const campaign = await getCampaignById(localCampaignId)
  if (!campaign) return result
  // Plan 1.4 leaves Performance Max for Plan 1.5g — its asset model differs
  // enough from RSAs that a single copy generator can't cover both.
  if (campaign.type === "PERFORMANCE_MAX") return result

  const promptRow = await getLatestPromptByCategory("google_ads_copy")
  const systemPrompt = promptRow?.prompt ?? FALLBACK_VOICE_PROMPT

  const adGroups = (await listAdGroupsForCampaign(campaign.id))
    .filter((ag) => ag.status === "ENABLED")
    .slice(0, options.maxAdGroups ?? 5)

  const finalUrl = options.finalUrl ?? PROD_DEFAULT_FINAL_URL

  // Build per-ad-group context in parallel — the keyword + ad lookups don't
  // depend on each other.
  const contexts: Array<AdGroupContext | null> = await Promise.all(
    adGroups.map(async (ag): Promise<AdGroupContext | null> => {
      const [keywords, ads] = await Promise.all([
        listKeywordsForAdGroup(ag.id),
        listAdsForAdGroup(ag.id),
      ])
      const enabledKeywords = keywords.filter((k) => k.status === "ENABLED")
      if (enabledKeywords.length < 3) return null
      const headlines = ads.flatMap((a) => a.headlines.map((h) => h.text)).slice(0, 30)
      const descriptions = ads.flatMap((a) => a.descriptions.map((d) => d.text)).slice(0, 12)
      return {
        ad_group_id_external: ag.ad_group_id,
        name: ag.name,
        top_keywords: enabledKeywords.slice(0, 20).map((k) => k.text),
        existing_headlines: headlines,
        existing_descriptions: descriptions,
      }
    }),
  )

  const eligible = contexts.filter((c): c is AdGroupContext => c !== null)
  result.ad_groups_skipped = adGroups.length - eligible.length
  if (eligible.length === 0) return result

  const userMessage = buildUserMessage(campaign.name, finalUrl, eligible)

  let batch: AdCopyBatch
  try {
    const aiResult = await callAgent(systemPrompt, userMessage, adCopyBatchSchema, {
      model: options.model ?? MODEL_SONNET,
      cacheSystemPrompt: true,
    })
    batch = aiResult.content
    result.tokens_used = aiResult.tokens_used
  } catch (err) {
    console.error(`[ad-copy] Claude call failed for campaign ${localCampaignId}:`, err)
    return result
  }

  result.ad_groups_scored = eligible.length
  result.variants_generated = batch.variants.length
  if (batch.variants.length === 0) return result

  // Round-trip each variant through recommendationItemSchema before insert so
  // the eventual apply path consumes a known-shape payload.
  const inserts = batch.variants
    .map((v) => {
      const recItem = {
        recommendation_type: "add_ad_variant" as const,
        scope_type: "ad_group" as const,
        scope_id: v.ad_group_id,
        payload: v.payload as unknown as Record<string, unknown>,
        reasoning: v.reasoning,
        confidence: v.confidence,
      }
      const parsed = recommendationItemSchema.safeParse(recItem)
      if (!parsed.success) return null
      return {
        customer_id: campaign.customer_id,
        scope_type: parsed.data.scope_type,
        scope_id: parsed.data.scope_id,
        recommendation_type: parsed.data.recommendation_type,
        payload: parsed.data.payload,
        reasoning: parsed.data.reasoning,
        confidence: parsed.data.confidence,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  try {
    const persisted = await insertRecommendations(inserts)
    result.variants_persisted = persisted.length
  } catch (err) {
    console.error(`[ad-copy] persist failed for campaign ${localCampaignId}:`, err)
  }

  return result
}

function buildUserMessage(
  campaignName: string,
  finalUrl: string,
  adGroups: AdGroupContext[],
): string {
  const lines: string[] = []
  lines.push(`# Campaign: ${campaignName}`)
  lines.push(`Final URL for variants: ${finalUrl}`)
  lines.push("")
  lines.push(
    "Generate ONE new RSA variant per ad group below. Headlines must be ≤30 chars (3-15 of them); descriptions must be ≤90 chars (2-4 of them). Reuse the strongest existing ideas where they work but write at least 50% net-new content per variant. Empty `variants` array is acceptable if no ad group warrants a new variant.",
  )
  lines.push("")
  for (const ag of adGroups) {
    lines.push(`## Ad group: ${ag.name}`)
    lines.push(`ad_group_id: ${ag.ad_group_id_external}`)
    lines.push(`Keywords (top 20): ${ag.top_keywords.map((k) => JSON.stringify(k)).join(", ")}`)
    if (ag.existing_headlines.length > 0) {
      lines.push(`Existing headlines: ${ag.existing_headlines.map((h) => JSON.stringify(h)).join(" | ")}`)
    }
    if (ag.existing_descriptions.length > 0) {
      lines.push(
        `Existing descriptions: ${ag.existing_descriptions.map((d) => JSON.stringify(d)).join(" | ")}`,
      )
    }
    lines.push("")
  }
  lines.push("Return the variants JSON object matching the schema.")
  return lines.join("\n")
}
