// lib/ads/new-campaign-mutation.ts
// Builds the multi-resource atomic mutation that creates a Search campaign
// from an agent-proposed blueprint. Used by the apply path when an admin
// approves a `new_campaign` recommendation.
//
// Everything is created as PAUSED so the admin can review in Google Ads
// (set geo targeting, link conversion actions, sanity-check ad copy)
// before flipping ENABLED. Geo targeting is intentionally NOT set on
// creation — converting blueprint geo strings ("Phoenix, AZ") into
// geoTargetConstant IDs requires Google's suggest API and is deferred.
// PMAX and DISPLAY are advisory-only — caller must guard those out.

import { ResourceNames } from "google-ads-api"
import type { CampaignBlueprintArgs } from "./agent/decision-schema"
import type { ResolvedGeoTarget } from "./geo-target-resolver"

export interface MutationOperation {
  entity: string
  operation: "create" | "update" | "remove"
  /**
   * Optional temp/real resource name. Required for parents that other ops
   * reference (budget, campaign, ad_group). Should be OMITTED for leaf ops
   * (criteria, keywords, RSAs) — the REST API's INCONSISTENT_FIELD_VALUES
   * check rejects composite temp IDs like `campaignCriteria/-2~-3`, and
   * leaves don't need cross-references anyway.
   */
  resource?: string
  [field: string]: unknown
}

// Language constant for English. Google's languageConstants table is global
// and stable — 1000 = English. See https://developers.google.com/google-ads/api/data/codes-formats#languages
const LANGUAGE_CONSTANT_ENGLISH = "languageConstants/1000"

const DEFAULT_AD_GROUP_CPC_MICROS = 1_000_000 // $1.00 — matches the blueprint CSV default

/**
 * Google Ads requires final_urls to be absolute (protocol + host). Inventory
 * rows (marketing_products.landing_url, events landing slugs) store relative
 * paths like "/programs/rotational-reboot" because they're consumed by both
 * the public site (Next.js) and the agent. Prepend the production origin
 * when the URL isn't already absolute.
 */
const PRODUCTION_ORIGIN = "https://www.darrenjpaul.com"

// Google Ads RSA hard limits, per https://support.google.com/google-ads/answer/7684791
const RSA_HEADLINE_MAX = 30
const RSA_DESCRIPTION_MAX = 90

/**
 * Truncates a string at the nearest word boundary <= maxLen so old/stale
 * AI-generated copy that exceeds Google's hard limits still apply cleanly
 * instead of being rejected at the Zod gate. Returns the original string if
 * already short enough.
 */
function truncateAtWord(s: string, maxLen: number): string {
  const trimmed = s.trim()
  if (trimmed.length <= maxLen) return trimmed
  const sliced = trimmed.slice(0, maxLen)
  const lastSpace = sliced.lastIndexOf(" ")
  // Only break at the last space when it's not too aggressive (i.e. would
  // leave at least 60% of the limit). Otherwise hard-cut at maxLen.
  if (lastSpace > Math.floor(maxLen * 0.6)) return sliced.slice(0, lastSpace).trim()
  return sliced.trim()
}

/**
 * Returns a copy of the blueprint payload with ad_copy.headlines and
 * descriptions trimmed to Google's hard limits. Called before Zod validation
 * in apply.ts so older recs whose strings exceed the current schema (the
 * agent has tightened its prompt over time) still go through.
 */
export function sanitizeBlueprintPayload(rawArgs: unknown): unknown {
  if (!rawArgs || typeof rawArgs !== "object") return rawArgs
  const args = rawArgs as Record<string, unknown>
  const adCopy = args.ad_copy as Record<string, unknown> | undefined
  if (!adCopy) return rawArgs
  const headlines = Array.isArray(adCopy.headlines)
    ? (adCopy.headlines as unknown[]).map((h) =>
        typeof h === "string" ? truncateAtWord(h, RSA_HEADLINE_MAX) : h,
      )
    : adCopy.headlines
  const descriptions = Array.isArray(adCopy.descriptions)
    ? (adCopy.descriptions as unknown[]).map((d) =>
        typeof d === "string" ? truncateAtWord(d, RSA_DESCRIPTION_MAX) : d,
      )
    : adCopy.descriptions
  return {
    ...args,
    ad_copy: { ...adCopy, headlines, descriptions },
  }
}

export function toAbsoluteFinalUrl(url: string): string {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // Always use production — campaigns must never point at localhost or a
  // preview deploy even when the apply is triggered from one.
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${PRODUCTION_ORIGIN}${path}`
}

/**
 * Builds the operations to atomically create:
 *   1 budget → 1 campaign → N ad groups → keywords + 1 RSA per ad group → campaign negatives
 *
 * All temp resource IDs are negative integers; the SDK resolves cross-
 * references inside a single mutateResources call. Returns ops in dependency
 * order (parents before children).
 */
export interface BuildNewCampaignOptions {
  /** YYYY-MM-DD; defaults to today. */
  startDate?: string
  /**
   * Geo targets resolved to Google Ads resource names. Empty array means
   * "no geo criteria" (i.e. target everywhere) — caller should have already
   * validated this is intentional via `validateGeoCoverage`.
   */
  geoTargets?: ResolvedGeoTarget[]
  /**
   * Optional conversion-action resource name (e.g.
   * "customers/123/conversionActions/456") to bind to the campaign via
   * selective_optimization. When omitted, the campaign inherits account-
   * level conversion settings.
   */
  conversionActionResource?: string | null
}

export function buildNewCampaignOps(
  customerId: string,
  blueprint: CampaignBlueprintArgs,
  options: BuildNewCampaignOptions = {},
): MutationOperation[] {
  if (blueprint.campaign_type !== "SEARCH") {
    throw new Error(
      `buildNewCampaignOps only supports SEARCH; got ${blueprint.campaign_type}`,
    )
  }

  const ops: MutationOperation[] = []
  let nextTempId = -1
  const tempId = () => String(nextTempId--)

  // Budget — daily, standard delivery.
  const budgetId = tempId()
  const budgetResource = ResourceNames.campaignBudget(customerId, budgetId)
  ops.push({
    entity: "campaign_budget",
    operation: "create",
    resource: budgetResource,
    name: `${blueprint.campaign_name} budget`,
    amount_micros: blueprint.daily_budget_cents * 10_000, // cents → micros
    delivery_method: "STANDARD",
    explicitly_shared: false,
  })

  // Campaign — Search, Manual CPC, PAUSED, English. selective_optimization
  // (when set) binds optimization to a specific conversion action so the
  // campaign optimizes against the right goal even if the account has
  // multiple actions configured.
  const campaignId = tempId()
  const campaignResource = ResourceNames.campaign(customerId, campaignId)
  const campaignOp: MutationOperation = {
    entity: "campaign",
    operation: "create",
    resource: campaignResource,
    name: blueprint.campaign_name,
    status: "PAUSED",
    advertising_channel_type: "SEARCH",
    campaign_budget: budgetResource,
    // Both fields are required on REST — biddingStrategyType is the explicit
    // enum and manualCpc is the strategy-specific payload. Setting only one
    // of them yields fieldError: REQUIRED on the other.
    bidding_strategy_type: "MANUAL_CPC",
    manual_cpc: { enhanced_cpc_enabled: false },
    network_settings: {
      target_google_search: true,
      target_search_network: true,
      target_content_network: false,
      target_partner_search_network: false,
    },
    // REST API accepts YYYY-MM-DD (with dashes); the dash-stripped YYYYMMDD
    // form is only valid for the gRPC proto path.
    start_date: options.startDate ?? new Date().toISOString().slice(0, 10),
    // Required since Google's 2025 EU political-ads compliance update. Even
    // for non-political accounts the field must be present on every campaign
    // create or the API returns fieldError: REQUIRED.
    contains_eu_political_advertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  }
  if (options.conversionActionResource) {
    campaignOp.selective_optimization = {
      conversion_actions: [options.conversionActionResource],
    }
  }
  ops.push(campaignOp)

  // Language criterion — English. Leaf op: no resource_name (the API
  // auto-assigns one; including a composite temp resource_name triggers
  // INCONSISTENT_FIELD_VALUES).
  ops.push({
    entity: "campaign_criterion",
    operation: "create",
    campaign: campaignResource,
    language: { language_constant: LANGUAGE_CONSTANT_ENGLISH },
  })

  // Geo target criteria — one per resolved location. Empty geoTargets means
  // "all locations" (intentional for worldwide online programs).
  for (const geo of options.geoTargets ?? []) {
    ops.push({
      entity: "campaign_criterion",
      operation: "create",
      campaign: campaignResource,
      location: { geo_target_constant: geo.resource_name },
    })
  }

  // Campaign-scope negative keywords (Broad match).
  for (const text of blueprint.negative_seed) {
    ops.push({
      entity: "campaign_criterion",
      operation: "create",
      campaign: campaignResource,
      negative: true,
      keyword: { text, match_type: "BROAD" },
    })
  }

  // Ad groups + their keywords + one RSA each.
  for (const theme of blueprint.keyword_themes) {
    const adGroupId = tempId()
    const adGroupResource = ResourceNames.adGroup(customerId, adGroupId)
    ops.push({
      entity: "ad_group",
      operation: "create",
      resource: adGroupResource,
      name: theme.theme,
      status: "PAUSED",
      campaign: campaignResource,
      type: "SEARCH_STANDARD",
      cpc_bid_micros: DEFAULT_AD_GROUP_CPC_MICROS,
    })

    for (const kwText of theme.keywords) {
      ops.push({
        entity: "ad_group_criterion",
        operation: "create",
        ad_group: adGroupResource,
        status: "ENABLED", // ad-group status (PAUSED) gates serving; keywords stay enabled
        keyword: { text: kwText, match_type: theme.match_type },
      })
    }

    ops.push({
      entity: "ad_group_ad",
      operation: "create",
      ad_group: adGroupResource,
      status: "PAUSED",
      ad: {
        final_urls: [toAbsoluteFinalUrl(blueprint.ad_copy.final_url)],
        responsive_search_ad: {
          headlines: blueprint.ad_copy.headlines.map((text) => ({ text })),
          descriptions: blueprint.ad_copy.descriptions.map((text) => ({ text })),
        },
      },
    })
  }

  return ops
}

/**
 * Extracts the real (post-API) campaign resource name from a mutateResources
 * response. The response is an array of MutateOperationResponse — for each
 * op we expect exactly one populated field whose key matches the entity type.
 * Returns null if the campaign op isn't found (which would be a contract
 * violation, but we don't want to crash the apply path on logging).
 */
export function extractCreatedCampaignResource(apiResponse: unknown): string | null {
  if (!apiResponse || typeof apiResponse !== "object") return null
  // The library returns either { mutate_operation_responses: [...] } or
  // (in some versions) the array directly. Handle both.
  const arr = Array.isArray(apiResponse)
    ? apiResponse
    : Array.isArray((apiResponse as Record<string, unknown>).mutate_operation_responses)
      ? ((apiResponse as Record<string, unknown>).mutate_operation_responses as unknown[])
      : Array.isArray((apiResponse as Record<string, unknown>).results)
        ? ((apiResponse as Record<string, unknown>).results as unknown[])
        : null
  if (!arr) return null
  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const campaignResult = (item as Record<string, unknown>).campaign_result as
      | { resource_name?: string }
      | undefined
    if (campaignResult?.resource_name) return campaignResult.resource_name
    // Some response shapes nest under `campaign`.
    const campaign = (item as Record<string, unknown>).campaign as
      | { resource_name?: string }
      | undefined
    if (campaign?.resource_name) return campaign.resource_name
  }
  return null
}
