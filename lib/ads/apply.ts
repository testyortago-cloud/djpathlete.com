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
import { getCustomerClient } from "@/lib/ads/google-ads-client"
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

interface MutationOperation {
  entity: string
  operation: "create" | "update" | "remove"
  resource: string
  [field: string]: unknown
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

  // Call Google Ads
  let apiResponse: unknown = null
  try {
    const customer = await getCustomerClient(rec.customer_id)
    // The library's MutateOperation<T> generic is overly strict (T flows into
    // `resource: T` but at runtime the field is a resource-name string with
    // the rest of the fields spread alongside). Our shape is correct;
    // mutateResources converts to protos internally.
    apiResponse = await customer.mutateResources(
      built.ops as unknown as Parameters<typeof customer.mutateResources>[0],
    )
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
