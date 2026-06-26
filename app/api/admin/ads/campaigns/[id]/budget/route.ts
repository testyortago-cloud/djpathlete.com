// app/api/admin/ads/campaigns/[id]/budget/route.ts
// Admin-only. Updates the daily budget on the CampaignBudget linked to a
// Google Ads campaign by issuing a `campaign_budget.update` mutate.
//
// Body: { daily_budget_dollars: number }   // e.g. 24.00
//   Internally converted to micros (× 1,000,000). Min $1/day. Hard cap at
//   $5,000/day as a fat-finger guard; raise if you really need to.
//
// Note: budgets are a SEPARATE resource in Google Ads, not a field on the
// campaign. Multiple campaigns CAN share one budget. We look up the budget
// resource name on-demand via GAQL so the local mirror doesn't need a new
// column. The mutate goes against `campaign_budget`, not `campaign`.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import {
  mutateResourcesRest,
  searchGoogleAdsRest,
  isRemovedResourceError,
} from "@/lib/ads/google-ads-rest"
import {
  getCampaignById,
  setCampaignBudgetMicros,
  setCampaignStatus,
} from "@/lib/db/google-ads-campaigns"

const MIN_DAILY_DOLLARS = 1
const MAX_DAILY_DOLLARS = 5000

const BodySchema = z.object({
  daily_budget_dollars: z
    .number()
    .finite()
    .min(MIN_DAILY_DOLLARS, `Daily budget must be at least $${MIN_DAILY_DOLLARS}`)
    .max(MAX_DAILY_DOLLARS, `Daily budget capped at $${MAX_DAILY_DOLLARS} as a safety guard`),
})

// REST search responses use camelCase keys (`campaignBudget`, `resourceName`),
// unlike the google-ads-api SDK that normalizes to snake_case. Reads here
// must use camelCase.
interface BudgetLookupRow {
  campaignBudget?: { resourceName?: string }
  campaign?: { campaignBudget?: string }
}

async function lookupBudgetResourceName(
  customerId: string,
  externalCampaignId: string,
): Promise<{ resourceName: string; sharedCampaignCount: number } | null> {
  const rows = (await searchGoogleAdsRest(
    customerId,
    `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${externalCampaignId}`,
  )) as BudgetLookupRow[]
  const resourceName =
    rows[0]?.campaignBudget?.resourceName ?? rows[0]?.campaign?.campaignBudget ?? null
  if (!resourceName) return null

  // Count campaigns sharing this budget so we can warn in the audit log if
  // the edit affects more than one campaign.
  const shared = (await searchGoogleAdsRest(
    customerId,
    `SELECT campaign.id FROM campaign WHERE campaign.campaign_budget = '${resourceName}' AND campaign.status != 'REMOVED'`,
  )) as Array<{ campaign?: { id?: string | number } }>
  return { resourceName, sharedCampaignCount: shared.length }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    )
  }
  const dollars = parsed.data.daily_budget_dollars
  const newMicros = Math.round(dollars * 1_000_000)

  const campaign = await getCampaignById(id)
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }
  if (campaign.status === "REMOVED") {
    return NextResponse.json(
      { error: "Cannot edit a REMOVED campaign — restore it in Google Ads first." },
      { status: 409 },
    )
  }
  if (campaign.budget_micros === newMicros) {
    return NextResponse.json({
      ok: true,
      budget_micros: newMicros,
      daily_budget_dollars: dollars,
      noop: true,
    })
  }

  const lookup = await lookupBudgetResourceName(campaign.customer_id, campaign.campaign_id).catch(
    (err) => ({ error: (err as Error).message }) as { error: string },
  )
  if (!lookup || "error" in lookup) {
    const message =
      lookup && "error" in lookup ? lookup.error : "Could not resolve budget resource"
    await recordAudit({
      action: "ads.campaign_budget_changed",
      category: "admin_write",
      outcome: "failure",
      target: { type: "google_ads_campaign", id, label: campaign.name },
      error: { message },
      metadata: {
        customer_id: campaign.customer_id,
        campaign_id: campaign.campaign_id,
        from_micros: campaign.budget_micros,
        to_micros: newMicros,
        stage: "lookup",
      },
      request,
    })
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const previousMicros = campaign.budget_micros

  try {
    await mutateResourcesRest(campaign.customer_id, [
      {
        entity: "campaign_budget",
        operation: "update",
        resource: lookup.resourceName,
        amount_micros: newMicros,
        update_mask: "amount_micros",
      },
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Stale local mirror — Google has this campaign REMOVED. Reconcile and return
    // a clear message (see the status route for the full rationale).
    const removedUpstream = isRemovedResourceError(message)
    if (removedUpstream) {
      try {
        await setCampaignStatus(id, "REMOVED")
      } catch (mirrorErr) {
        console.warn(
          `[ads/campaigns/${id}/budget] failed to reconcile stale status to REMOVED: ${(mirrorErr as Error).message}`,
        )
      }
    }
    await recordAudit({
      action: "ads.campaign_budget_changed",
      category: "admin_write",
      outcome: "failure",
      target: { type: "google_ads_campaign", id, label: campaign.name },
      error: { message },
      metadata: {
        customer_id: campaign.customer_id,
        campaign_id: campaign.campaign_id,
        budget_resource: lookup.resourceName,
        from_micros: previousMicros,
        to_micros: newMicros,
        shared_campaigns: lookup.sharedCampaignCount,
        stage: "mutate",
        removed_upstream: removedUpstream,
      },
      request,
    })
    if (removedUpstream) {
      return NextResponse.json(
        {
          error:
            "This campaign was removed in Google Ads, so its budget can't be changed. It's now marked as removed here too.",
          removed: true,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Mirror to local row(s). The budget may be shared — update every campaign
  // pointing at it would require us to track resource names, which we don't.
  // For now, update the campaign the admin actually edited; nightly sync
  // reconciles any siblings.
  try {
    await setCampaignBudgetMicros(id, newMicros)
  } catch (mirrorErr) {
    console.warn(
      `[ads/campaigns/${id}/budget] mutate succeeded but mirror update failed: ${(mirrorErr as Error).message}`,
    )
  }

  await recordAudit({
    action: "ads.campaign_budget_changed",
    category: "admin_write",
    target: { type: "google_ads_campaign", id, label: campaign.name },
    metadata: {
      customer_id: campaign.customer_id,
      campaign_id: campaign.campaign_id,
      budget_resource: lookup.resourceName,
      from_micros: previousMicros,
      to_micros: newMicros,
      shared_campaigns: lookup.sharedCampaignCount,
    },
    request,
  })

  return NextResponse.json({
    ok: true,
    budget_micros: newMicros,
    daily_budget_dollars: dollars,
    previous_micros: previousMicros,
    shared_campaign_count: lookup.sharedCampaignCount,
  })
}
