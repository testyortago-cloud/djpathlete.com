// app/api/admin/ads/campaigns/[id]/name/route.ts
// Admin-only. Renames a Google Ads campaign by issuing a `campaign.update`
// mutate with update_mask=name, then mirrors to google_ads_campaigns.name.
//
// Body: { name: string }
// Google Ads enforces uniqueness within an account server-side; we surface
// that as a 502 with the API error message.

import { ResourceNames } from "google-ads-api"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import { mutateResourcesRest, isRemovedResourceError } from "@/lib/ads/google-ads-rest"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  getCampaignById,
  setCampaignName,
  setCampaignStatus,
} from "@/lib/db/google-ads-campaigns"

const MAX_NAME_LENGTH = 255

const BodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(MAX_NAME_LENGTH, `Name must be ${MAX_NAME_LENGTH} characters or fewer`),
})

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
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    )
  }
  const nextName = parsed.data.name

  const campaign = await getCampaignById(id)
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 })
  }
  if (campaign.status === "REMOVED") {
    return NextResponse.json(
      { error: "Cannot rename a REMOVED campaign — restore it in Google Ads first." },
      { status: 409 },
    )
  }
  if (campaign.name === nextName) {
    return NextResponse.json({ ok: true, name: nextName, noop: true })
  }

  const previousName = campaign.name
  const resource = ResourceNames.campaign(campaign.customer_id, campaign.campaign_id)

  try {
    await mutateResourcesRest(campaign.customer_id, [
      {
        entity: "campaign",
        operation: "update",
        resource,
        name: nextName,
        update_mask: "name",
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
          `[ads/campaigns/${id}/name] failed to reconcile stale status to REMOVED: ${(mirrorErr as Error).message}`,
        )
      }
    }
    await recordAudit({
      action: "ads.campaign_renamed",
      category: "admin_write",
      outcome: "failure",
      target: { type: "google_ads_campaign", id, label: previousName },
      error: { message },
      metadata: {
        customer_id: campaign.customer_id,
        campaign_id: campaign.campaign_id,
        from: previousName,
        to: nextName,
        removed_upstream: removedUpstream,
      },
      request,
    })
    if (removedUpstream) {
      return NextResponse.json(
        {
          error:
            "This campaign was removed in Google Ads, so it can't be renamed. It's now marked as removed here too.",
          removed: true,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }

  try {
    await setCampaignName(id, nextName)
  } catch (mirrorErr) {
    console.warn(
      `[ads/campaigns/${id}/name] mutate succeeded but mirror update failed: ${(mirrorErr as Error).message}`,
    )
  }

  await recordAudit({
    action: "ads.campaign_renamed",
    category: "admin_write",
    target: { type: "google_ads_campaign", id, label: nextName },
    metadata: {
      customer_id: campaign.customer_id,
      campaign_id: campaign.campaign_id,
      from: previousName,
      to: nextName,
    },
    request,
  })

  return NextResponse.json({ ok: true, name: nextName, previous: previousName })
}
