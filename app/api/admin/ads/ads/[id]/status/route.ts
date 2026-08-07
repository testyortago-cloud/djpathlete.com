// app/api/admin/ads/ads/[id]/status/route.ts
// Admin-only. Pauses or resumes a Google Ads ad by issuing an
// `ad_group_ad.update` mutate against the REST API with update_mask=status,
// then mirrors the new status to google_ads_ads.status so the UI reflects
// it without waiting for nightly sync.
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
  getAdForMutation,
  setAdStatus,
} from "@/lib/db/google-ads-ads"

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

  const ad = await getAdForMutation(id)
  if (!ad) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 })
  }
  if (ad.status === "REMOVED") {
    return NextResponse.json(
      { error: "Cannot toggle a REMOVED ad — restore it in Google Ads first." },
      { status: 409 },
    )
  }
  if (ad.status === nextStatus) {
    return NextResponse.json({ ok: true, status: nextStatus, noop: true })
  }

  const previousStatus = ad.status
  const resource = ResourceNames.adGroupAd(ad.customer_id, ad.ad_group_id_external, ad.ad_id)

  try {
    await mutateResourcesRest(ad.customer_id, [
      {
        entity: "ad_group_ad",
        operation: "update",
        resource,
        status: nextStatus,
        update_mask: "status",
      },
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The local mirror was stale: Google has this ad REMOVED while our row
    // still said ENABLED/PAUSED (the nightly sync skips REMOVED resources). Flip
    // the local status so the UI stops offering resume, and return a clear,
    // actionable message instead of the raw API error.
    const removedUpstream = isRemovedResourceError(message)
    if (removedUpstream) {
      try {
        await setAdStatus(id, "REMOVED")
      } catch (mirrorErr) {
        console.warn(
          `[ads/ads/${id}/status] failed to reconcile stale status to REMOVED: ${(mirrorErr as Error).message}`,
        )
      }
    }
    await recordAudit({
      action: "ads.ad_status_changed",
      category: "admin_write",
      outcome: "failure",
      target: { type: "google_ads_ad", id, label: ad.headline ?? ad.ad_id },
      error: { message },
      metadata: {
        customer_id: ad.customer_id,
        ad_id: ad.ad_id,
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
            "This ad was removed in Google Ads, so it can't be resumed. It's now marked as removed here too — create a new ad to advertise again.",
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
    await setAdStatus(id, nextStatus)
  } catch (mirrorErr) {
    console.warn(
      `[ads/ads/${id}/status] mutate succeeded but mirror update failed: ${(mirrorErr as Error).message}`,
    )
  }

  await recordAudit({
    action: "ads.ad_status_changed",
    category: "admin_write",
    target: { type: "google_ads_ad", id, label: ad.headline ?? ad.ad_id },
    metadata: {
      customer_id: ad.customer_id,
      ad_id: ad.ad_id,
      from: previousStatus,
      to: nextStatus,
    },
    request,
  })

  return NextResponse.json({ ok: true, status: nextStatus, previous: previousStatus })
}
