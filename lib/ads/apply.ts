// lib/ads/apply.ts
// Apply path: takes an approved (or auto_apply-eligible) recommendation,
// builds the corresponding Google Ads mutation, calls mutateResources,
// writes a google_ads_automation_log row, and updates the recommendation
// status to applied / auto_applied / failed.
//
// Never throws on mutation failure — captures the error in automation_log
// and flips the rec to failed. Callers (approve route, auto-pilot scan) get
// a structured ApplyResult back.

import { ResourceNames } from "google-ads-api"
import {
  getRecommendationById,
  setRecommendationApplied,
  setRecommendationFailed,
} from "@/lib/db/google-ads-recommendations"
import { insertAutomationLog } from "@/lib/db/google-ads-automation-log"
import { getCampaignById } from "@/lib/db/google-ads-campaigns"
import { resolveAdGroupByExternalId } from "@/lib/db/google-ads-ad-groups"
import { resolveKeywordExternalIds } from "@/lib/db/google-ads-keywords"
import { resolveAdExternalIds } from "@/lib/db/google-ads-ads"
import {
  adVariantPayloadSchema,
  bidAdjustmentPayloadSchema,
  keywordRefPayloadSchema,
  negativeKeywordPayloadSchema,
  newKeywordPayloadSchema,
} from "@/lib/validators/ads"
import { campaignBlueprintArgsSchema } from "@/lib/ads/agent/decision-schema"
import {
  buildNewCampaignOps,
  sanitizeBlueprintPayload,
  type MutationOperation,
} from "@/lib/ads/new-campaign-mutation"
import { resolveGeoTargets, validateGeoCoverage } from "@/lib/ads/geo-target-resolver"
import { mutateResourcesRest } from "@/lib/ads/google-ads-rest"
import { upsertCampaign } from "@/lib/db/google-ads-campaigns"
import type {
  GoogleAdsAutomationMode,
  GoogleAdsRecommendation,
  GoogleAdsRecommendationType,
} from "@/types/database"

export interface ApplyResult {
  recommendation_id: string
  applied: boolean
  status: "applied" | "auto_applied" | "failed"
  error?: string
}

/**
 * Builds the mutation operation for a recommendation. Returns a string error
 * message if the rec is malformed or its referenced entity is missing from
 * our local mirror (likely sync lag — caller should retry after next sync).
 */
async function buildMutation(
  rec: GoogleAdsRecommendation,
): Promise<{ ok: true; ops: MutationOperation[] } | { ok: false; error: string }> {
  const customerId = rec.customer_id

  switch (rec.recommendation_type) {
    case "add_negative_keyword": {
      const parsed = negativeKeywordPayloadSchema.safeParse(rec.payload)
      if (!parsed.success) return { ok: false, error: `Invalid payload: ${parsed.error.message}` }
      if (rec.scope_type !== "campaign") {
        return { ok: false, error: "add_negative_keyword expects scope_type=campaign" }
      }
      // scope_id here is the external campaign_id; -1 = "create" placeholder
      const op: MutationOperation = {
        entity: "campaign_criterion",
        operation: "create",
        resource: ResourceNames.campaignCriterion(customerId, rec.scope_id, "-1"),
        campaign: ResourceNames.campaign(customerId, rec.scope_id),
        negative: true,
        keyword: { text: parsed.data.text, match_type: parsed.data.match_type },
      }
      return { ok: true, ops: [op] }
    }

    case "adjust_bid": {
      const parsed = bidAdjustmentPayloadSchema.safeParse(rec.payload)
      if (!parsed.success) return { ok: false, error: `Invalid payload: ${parsed.error.message}` }
      const lookup = await resolveKeywordExternalIds(customerId, rec.scope_id)
      if (!lookup) return { ok: false, error: `Keyword ${rec.scope_id} not found in mirror` }
      const op: MutationOperation = {
        entity: "ad_group_criterion",
        operation: "update",
        resource: ResourceNames.adGroupCriterion(
          customerId,
          lookup.ad_group_id_external,
          lookup.criterion_id,
        ),
        cpc_bid_micros: parsed.data.proposed_micros,
      }
      return { ok: true, ops: [op] }
    }

    case "pause_keyword": {
      const parsed = keywordRefPayloadSchema.safeParse(rec.payload)
      if (!parsed.success) return { ok: false, error: `Invalid payload: ${parsed.error.message}` }
      const lookup = await resolveKeywordExternalIds(customerId, parsed.data.criterion_id)
      if (!lookup) return { ok: false, error: `Keyword ${parsed.data.criterion_id} not found` }
      const op: MutationOperation = {
        entity: "ad_group_criterion",
        operation: "update",
        resource: ResourceNames.adGroupCriterion(
          customerId,
          lookup.ad_group_id_external,
          lookup.criterion_id,
        ),
        status: "PAUSED",
      }
      return { ok: true, ops: [op] }
    }

    case "add_keyword": {
      const parsed = newKeywordPayloadSchema.safeParse(rec.payload)
      if (!parsed.success) return { ok: false, error: `Invalid payload: ${parsed.error.message}` }
      if (rec.scope_type !== "ad_group") {
        return { ok: false, error: "add_keyword expects scope_type=ad_group" }
      }
      const op: MutationOperation = {
        entity: "ad_group_criterion",
        operation: "create",
        resource: ResourceNames.adGroupCriterion(customerId, rec.scope_id, "-1"),
        ad_group: ResourceNames.adGroup(customerId, rec.scope_id),
        status: "ENABLED",
        keyword: { text: parsed.data.text, match_type: parsed.data.match_type },
        ...(parsed.data.initial_cpc_bid_micros != null
          ? { cpc_bid_micros: parsed.data.initial_cpc_bid_micros }
          : {}),
      }
      return { ok: true, ops: [op] }
    }

    case "add_ad_variant": {
      const parsed = adVariantPayloadSchema.safeParse(rec.payload)
      if (!parsed.success) return { ok: false, error: `Invalid payload: ${parsed.error.message}` }
      if (rec.scope_type !== "ad_group") {
        return { ok: false, error: "add_ad_variant expects scope_type=ad_group" }
      }
      const op: MutationOperation = {
        entity: "ad_group_ad",
        operation: "create",
        resource: ResourceNames.adGroupAd(customerId, rec.scope_id, "-1"),
        ad_group: ResourceNames.adGroup(customerId, rec.scope_id),
        status: "ENABLED",
        ad: {
          responsive_search_ad: {
            headlines: parsed.data.headlines.map((text) => ({ text })),
            descriptions: parsed.data.descriptions.map((text) => ({ text })),
          },
          final_urls: [parsed.data.final_url],
        },
      }
      return { ok: true, ops: [op] }
    }

    case "pause_ad": {
      const adId = (rec.payload as { ad_id?: unknown }).ad_id
      if (typeof adId !== "string" || adId.length === 0) {
        return { ok: false, error: "pause_ad payload requires ad_id (string)" }
      }
      const lookup = await resolveAdExternalIds(customerId, adId)
      if (!lookup) return { ok: false, error: `Ad ${adId} not found in mirror` }
      const op: MutationOperation = {
        entity: "ad_group_ad",
        operation: "update",
        resource: ResourceNames.adGroupAd(
          customerId,
          lookup.ad_group_id_external,
          lookup.ad_id,
        ),
        status: "PAUSED",
      }
      return { ok: true, ops: [op] }
    }

    case "new_campaign": {
      // The agent stores the blueprint under `payload.args`; older or
      // hand-edited rows may have it at the top level. Try args first.
      const rawArgs =
        (rec.payload as { args?: unknown }).args ?? (rec.payload as unknown)
      // Trim ad-copy strings to Google's hard limits before validation —
      // older recs were generated under a more lenient schema and would
      // otherwise be rejected for length violations alone.
      const sanitized = sanitizeBlueprintPayload(rawArgs)
      const parsed = campaignBlueprintArgsSchema.safeParse(sanitized)
      if (!parsed.success) {
        return { ok: false, error: `Invalid blueprint: ${parsed.error.message}` }
      }
      // PMAX / Display need asset groups + a different mutation graph; keep
      // those advisory until we add a dedicated builder. The blueprint CSV
      // export still works for them.
      if (parsed.data.campaign_type !== "SEARCH") {
        return {
          ok: false,
          error: `${parsed.data.campaign_type} auto-create is not yet supported — use the blueprint CSV from the recommendation card`,
        }
      }

      // Resolve geo strings → geoTargetConstant resource names. The blueprint
      // mixes ISO codes ("US", "AU") for worldwide programs and city/region
      // strings ("Tampa Bay, FL") for in-person services and events.
      const { resolved: resolvedGeo, unresolved } = await resolveGeoTargets(
        parsed.data.geo_targets,
      )

      // Refuse to ship a lead-gen / booking / event campaign with no resolved
      // location — those should never run nationwide by accident. Online
      // purchase campaigns may legitimately ship with no geo (= worldwide).
      const inventoryKind =
        ((rec.payload as { args?: { inventory_kind?: unknown } }).args?.inventory_kind ??
          (rec.payload as { inventory_kind?: unknown }).inventory_kind) === "event"
          ? "event"
          : "product"
      const coverage = validateGeoCoverage({
        conversion_type: parsed.data.conversion_goal === "form_submission_lead"
          ? "lead"
          : parsed.data.conversion_goal === "purchase"
            ? "purchase"
            : "booking",
        inventory_kind: inventoryKind,
        resolved_count: resolvedGeo.length,
        unresolved,
        source_count: parsed.data.geo_targets.length,
      })
      if (!coverage.ok) {
        return { ok: false, error: coverage.error }
      }

      // Conversion-action linking on Search campaigns is account-level by
      // default (set in Google Ads UI → Tools → Conversions → Settings).
      // Per-campaign overrides require CampaignConversionGoal resources,
      // which are a separate mutation graph — deferred until needed.
      const ops = buildNewCampaignOps(customerId, parsed.data, {
        geoTargets: resolvedGeo,
      })
      return { ok: true, ops }
    }

    // Phase 1.6+ ads-agent types — these land in the recommendations queue
    // as advisory only. They have no Google Ads mutation path yet; approval
    // is a human acknowledgement, not an auto-apply. Reject the apply call
    // with a clear message so the queue stays honest.
    case "budget_shift":
    case "audience_expansion":
    case "campaign_pause":
    case "campaign_split":
    case "match_type_change":
    case "bid_strategy_review":
    case "flag":
      return {
        ok: false,
        error: `${rec.recommendation_type} is advisory only; no apply path implemented`,
      }
  }
}

interface ApplyOptions {
  /**
   * Mode at the time of apply — recorded in automation_log for the audit
   * trail. Caller decides; for approve-flow this is 'co_pilot' (the user
   * clicked approve), for the auto-pilot scan it's 'auto_pilot'.
   */
  mode: GoogleAdsAutomationMode
  /**
   * Either a user_id (manual) or 'system' (auto-pilot).
   */
  actor: string
}

/**
 * Loads the rec, builds the mutation, calls mutateResources, writes the log,
 * updates rec status. The single source of truth for "apply this rec".
 */
export async function applyRecommendation(
  recId: string,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const rec = await getRecommendationById(recId)
  if (!rec) {
    return { recommendation_id: recId, applied: false, status: "failed", error: "Recommendation not found" }
  }

  // Build mutation first — if it fails (bad payload, missing parent), we don't
  // even hit Google's API; record the failure and bail.
  const built = await buildMutation(rec)
  if (!built.ok) {
    await insertAutomationLog({
      recommendation_id: rec.id,
      customer_id: rec.customer_id,
      mode: options.mode,
      actor: options.actor,
      api_request: { rec_type: rec.recommendation_type, scope: rec.scope_id, payload: rec.payload },
      api_response: null,
      result_status: "failure",
      error_message: built.error,
    })
    await setRecommendationFailed(rec.id, built.error)
    return { recommendation_id: rec.id, applied: false, status: "failed", error: built.error }
  }

  // Call Google Ads via REST. The gRPC SDK (customer.mutateResources) crashes
  // on Vercel with "Channel credentials must be a ChannelCredentials object"
  // because Webpack-bundled lambdas duplicate @grpc/grpc-js, breaking an
  // internal instanceof check. REST has none of that machinery and accepts
  // the same MutationOperation shape after a snake_case→camelCase pass.
  let apiResponse: unknown = null
  try {
    // partial_failure=true on new_campaign so a single policy-flagged keyword
    // (e.g. HEALTH_IN_PERSONALIZED_ADS on Assessment campaigns) drops just
    // that keyword instead of killing the whole campaign create. Other
    // recommendation types are single-op so partial_failure has no effect.
    const result = await mutateResourcesRest(rec.customer_id, built.ops, {
      partialFailure: rec.recommendation_type === "new_campaign",
    })
    apiResponse = result.response
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await insertAutomationLog({
      recommendation_id: rec.id,
      customer_id: rec.customer_id,
      mode: options.mode,
      actor: options.actor,
      api_request: { ops: built.ops },
      api_response: null,
      result_status: "failure",
      error_message: message,
    })
    await setRecommendationFailed(rec.id, message)
    return { recommendation_id: rec.id, applied: false, status: "failed", error: message }
  }

  // Success
  await insertAutomationLog({
    recommendation_id: rec.id,
    customer_id: rec.customer_id,
    mode: options.mode,
    actor: options.actor,
    api_request: { ops: built.ops },
    api_response: apiResponse as Record<string, unknown> | null,
    result_status: "success",
  })

  // If this was a new_campaign apply, insert the created campaign into the
  // local mirror immediately so /admin/ads/campaigns and the agent's
  // snapshot see it without waiting for the nightly sync. Best-effort —
  // failure here doesn't roll back the Google Ads create; sync will pick
  // it up later.
  if (rec.recommendation_type === "new_campaign") {
    try {
      await mirrorNewlyCreatedCampaign(rec, apiResponse)
    } catch (mirrorErr) {
      console.warn(
        `[apply] new campaign created but mirror insert failed (sync will reconcile): ${(mirrorErr as Error).message}`,
      )
    }
  }

  if (options.mode === "auto_pilot") {
    // Plan 1.3: auto-applied recs use a distinct status so they're filterable
    // in the queue. setRecommendationApplied flips to 'applied'; we override
    // here to 'auto_applied' which the same DAL helper doesn't support, so
    // we'll use a direct supabase call.
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const { error } = await supabase
      .from("google_ads_recommendations")
      .update({ status: "auto_applied", applied_at: new Date().toISOString() })
      .eq("id", rec.id)
    if (error) {
      // Mutation succeeded but local status update failed — rare. Log loud.
      console.error("[apply] mutation succeeded but auto_applied flip failed:", error)
    }
    return { recommendation_id: rec.id, applied: true, status: "auto_applied" }
  }

  await setRecommendationApplied(rec.id)
  return { recommendation_id: rec.id, applied: true, status: "applied" }
}

/**
 * Reads the campaignResult from a successful mutateOperationResponses array
 * and inserts a row into google_ads_campaigns so the UI + agent see the new
 * campaign immediately. Pulls budget/name/dates from the blueprint payload
 * — the next nightly sync will overwrite with authoritative Google Ads data.
 */
async function mirrorNewlyCreatedCampaign(
  rec: GoogleAdsRecommendation,
  apiResponse: unknown,
): Promise<void> {
  const responses = (apiResponse as {
    mutateOperationResponses?: Array<{
      campaignResult?: { resourceName?: string }
    }>
  })?.mutateOperationResponses
  if (!responses) return
  const campaignResult = responses.find((r) => r.campaignResult)?.campaignResult
  if (!campaignResult?.resourceName) return
  // resourceName format: customers/{customer_id}/campaigns/{campaign_id}
  const externalCampaignId = campaignResult.resourceName.split("/").pop()
  if (!externalCampaignId) return

  const rawArgs =
    (rec.payload as { args?: unknown }).args ?? (rec.payload as unknown)
  const args = rawArgs as {
    campaign_name?: string
    daily_budget_cents?: number
    campaign_type?: "SEARCH" | "PMAX" | "DISPLAY"
  }

  await upsertCampaign({
    customer_id: rec.customer_id,
    campaign_id: externalCampaignId,
    name: args.campaign_name ?? "Unnamed campaign",
    type: args.campaign_type === "PMAX"
      ? "PERFORMANCE_MAX"
      : args.campaign_type === "DISPLAY"
        ? "DISPLAY"
        : "SEARCH",
    status: "PAUSED",
    bidding_strategy: "MANUAL_CPC",
    budget_micros: args.daily_budget_cents != null ? args.daily_budget_cents * 10_000 : null,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: null,
    raw_data: { source: "apply_path_mirror", recommendation_id: rec.id },
  })
}

/**
 * Auto-pilot scan: for one customer, find pending negative-keyword recs at
 * confidence ≥ 0.8 in auto_pilot-mode campaigns and apply each. Caps at 10
 * per run to bound damage if the AI floods recs. Returns counts.
 */
export interface AutoPilotResult {
  scanned: number
  applied: number
  failed: number
  cap_reached: boolean
}

const AUTO_PILOT_CONFIDENCE_THRESHOLD = 0.8
const AUTO_PILOT_DAILY_CAP = 10

const ALLOWED_AUTO_TYPES: GoogleAdsRecommendationType[] = ["add_negative_keyword"]

export async function runAutoPilotApply(customerId: string): Promise<AutoPilotResult> {
  const { listRecommendations } = await import("@/lib/db/google-ads-recommendations")
  const recs = await listRecommendations({
    customer_id: customerId,
    status: "pending",
    limit: 100,
  })

  const result: AutoPilotResult = { scanned: 0, applied: 0, failed: 0, cap_reached: false }

  // Resolve auto_pilot campaigns once per scan — the rec's scope_id for
  // negative keywords is the external campaign_id, not the local UUID.
  const eligible = recs.filter(
    (r) =>
      ALLOWED_AUTO_TYPES.includes(r.recommendation_type) &&
      r.confidence >= AUTO_PILOT_CONFIDENCE_THRESHOLD,
  )

  // Walk eligibility: for each, look up the parent campaign's mode
  for (const rec of eligible) {
    if (result.applied >= AUTO_PILOT_DAILY_CAP) {
      result.cap_reached = true
      break
    }
    if (rec.scope_type !== "campaign") continue
    result.scanned++

    // We need the local campaign row to read its automation_mode. The rec's
    // scope_id is the external campaign_id; resolve to the local row first.
    const { createServiceRoleClient } = await import("@/lib/supabase")
    const supabase = createServiceRoleClient()
    const { data: campaignRow } = await supabase
      .from("google_ads_campaigns")
      .select("id, automation_mode, type")
      .eq("customer_id", customerId)
      .eq("campaign_id", rec.scope_id)
      .maybeSingle()

    if (!campaignRow) continue
    if ((campaignRow as { automation_mode: string }).automation_mode !== "auto_pilot") continue
    // Performance Max gets locked to advisory by spec D7; defense-in-depth:
    // reject auto-apply even if mode somehow got set wrong.
    if ((campaignRow as { type: string }).type === "PERFORMANCE_MAX") continue

    const applyResult = await applyRecommendation(rec.id, {
      mode: "auto_pilot",
      actor: "system",
    })
    if (applyResult.applied) result.applied++
    else result.failed++
  }

  return result
}

// Re-export for the apply route
export { getCampaignById }
