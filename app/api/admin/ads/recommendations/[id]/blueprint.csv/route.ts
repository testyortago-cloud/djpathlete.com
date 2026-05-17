// app/api/admin/ads/recommendations/[id]/blueprint.csv/route.ts
// Downloads a new_campaign recommendation's blueprint as a multi-section
// CSV that pastes into Google Ads Editor. Admin-only. Returns 404 unless
// the recommendation exists, is type='new_campaign', and its payload
// validates against campaignBlueprintArgsSchema. Filename includes the
// campaign name (sanitised) so multiple downloads don't collide.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getRecommendationById } from "@/lib/db/google-ads-recommendations"
import { campaignBlueprintArgsSchema } from "@/lib/ads/agent/decision-schema"
import { renderCampaignBlueprintCsv } from "@/lib/ads/campaign-blueprint-csv"

interface RouteContext {
  params: Promise<{ id: string }>
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "campaign"
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params

  const rec = await getRecommendationById(id)
  if (!rec) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 })
  }
  if (rec.recommendation_type !== "new_campaign") {
    return NextResponse.json(
      { error: "Recommendation is not a new_campaign blueprint" },
      { status: 400 },
    )
  }

  // Ads-agent recommendations store the model's args under payload.args.
  // Older / manually-created recs may store args directly — accept both.
  const payload = (rec.payload ?? {}) as Record<string, unknown>
  const candidate = (payload.args as Record<string, unknown> | undefined) ?? payload
  const parsed = campaignBlueprintArgsSchema.safeParse(candidate)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Blueprint payload does not match the campaign-blueprint schema",
        issues: parsed.error.issues,
      },
      { status: 422 },
    )
  }

  const csv = renderCampaignBlueprintCsv(parsed.data)
  const filename = `${sanitiseFilename(parsed.data.campaign_name)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
}
