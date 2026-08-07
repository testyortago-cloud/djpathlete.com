// app/api/admin/ads/campaigns/[id]/status/route.ts
// Admin-only. Pauses or resumes a Google Ads campaign by issuing a
// `campaign.update` mutate against the REST API with update_mask=status,
// then mirrors the new status to google_ads_campaigns.status so the UI
// reflects it without waiting for nightly sync.
//
// Body: { status: "ENABLED" | "PAUSED" }
// "REMOVED" is intentionally NOT accepted — removal is destructive and
// belongs in the Google Ads web UI where the operator gets the full context.

import { ResourceNames } from "google-ads-api"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { mutateResourcesRest, isRemovedResourceError } from "@/lib/ads/google-ads-rest"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  getCampaignById,
  setCampaignStatus,
} from "@/lib/db/google-ads-campaigns"

const BodySchema = z.object({ status: z.enum(["ENABLED", "PAUSED"]) })

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "status must be ENABLED or PAUSED" },
      { status: 400 },
    )
  }
  const nextStatus = parsed.data.status

  const campaign = await getCampaignById(id)
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }
  if (campaign.status === "REMOVED") {
    return NextResponse.json(
      { error: "Cannot toggle a REMOVED campaign — restore it in Google Ads first." },
      { status: 409 },
    )
  }
  if (campaign.status === nextStatus) {
    return NextResponse.json({ ok: true, status: nextStatus, noop: true })
  }

  const previousStatus = campaign.status
  const resource = ResourceNames.campaign(campaign.customer_id, campaign.campaign_id)

  try {
    await mutateResourcesRest(campaign.customer_id, [
      {
        entity: "campaign",
        operation: "update",
        resource,
        status: nextStatus,
        update_mask: "status",
      },
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The local mirror was stale: Google has this campaign REMOVED while our row
    // still said ENABLED/PAUSED (the nightly sync skips REMOVED campaigns). Flip
    // the local status so the UI stops offering resume, and return a clear,
    // actionable message instead of the raw API error.
    const removedUpstream = isRemovedResourceError(message)
    if (removedUpstream) {
      try {
        await setCampaignStatus(id, "REMOVED")
      } catch (mirrorErr) {
        console.warn(
          `[ads/campaigns/${id}/status] failed to reconcile stale status to REMOVED: ${(mirrorErr as Error).message}`,
        )
      }
    }
    await recordAudit({
      action: "ads.campaign_status_changed",
      category: "admin_write",
      outcome: "failure",
      target: { type: "google_ads_campaign", id, label: campaign.name },
      error: { message },
      metadata: {
        customer_id: campaign.customer_id,
        campaign_id: campaign.campaign_id,
        from: previousStatus,
        to: nextStatus,
        removed_upstream: removedUpstream,
      },
      request,
    })
    if (removedUpstream) {
      return NextResponse.json(
        {
          error:
            "This campaign was removed in Google Ads, so it can't be resumed. It's now marked as removed here too — create a new campaign to advertise again.",
          removed: true,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Mirror to local row. Best-effort; if this fails the next nightly sync
  // reconciles, so we still return ok to the caller.
  try {
    await setCampaignStatus(id, nextStatus)
  } catch (mirrorErr) {
    console.warn(
      `[ads/campaigns/${id}/status] mutate succeeded but mirror update failed: ${(mirrorErr as Error).message}`,
    )
  }

  await recordAudit({
    action: "ads.campaign_status_changed",
    category: "admin_write",
    target: { type: "google_ads_campaign", id, label: campaign.name },
    metadata: {
      customer_id: campaign.customer_id,
      campaign_id: campaign.campaign_id,
      from: previousStatus,
      to: nextStatus,
    },
    request,
  })

  return NextResponse.json({ ok: true, status: nextStatus, previous: previousStatus })
}
