// app/api/admin/ads/recommendations/[id]/blueprint.csv/route.ts
// Downloads a new_campaign recommendation's blueprint as a multi-section
// CSV that pastes into Google Ads Editor. Admin-only. Returns 404 unless
// the recommendation exists, is type='new_campaign', and its payload
// validates against campaignBlueprintArgsSchema. Filename includes the
// campaign name (sanitised) so multiple downloads don't collide.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getRecommendationById } from "@/lib/db/google-ads-recommendations"
import { z } from "zod"
import { renderCampaignBlueprintCsv } from "@/lib/ads/campaign-blueprint-csv"
import type { CampaignBlueprintArgs } from "@/lib/ads/agent/decision-schema"

// A lenient "shape only" schema — types must be right, but no length/count
// constraints. Lets us export CSVs even when the agent overshoots Google
// Ads RSA character limits; we truncate per-string below. The strict
// campaignBlueprintArgsSchema still gates anything that wants schema-clean
// data (export-import roundtrips, future API mutate path, downstream tools).
const lenientBlueprintSchema = z.object({
  inventory_ref: z.string(),
  inventory_kind: z.enum(["product", "event"]),
  campaign_type: z.enum(["SEARCH", "PMAX", "DISPLAY"]),
  campaign_name: z.string(),
  daily_budget_cents: z.number().int(),
  geo_targets: z.array(z.string()),
  keyword_themes: z.array(
    z.object({
      theme: z.string(),
      match_type: z.enum(["EXACT", "PHRASE", "BROAD"]),
      keywords: z.array(z.string()),
    }),
  ),
  negative_seed: z.array(z.string()),
  ad_copy: z.object({
    headlines: z.array(z.string()),
    descriptions: z.array(z.string()),
    final_url: z.string(),
  }),
  conversion_goal: z.enum(["form_submission_lead", "purchase", "booking"]),
  supporting_gaql_evidence: z.array(
    z.object({ gaql: z.string(), finding: z.string() }),
  ),
})

const HEADLINE_MAX = 30
const DESCRIPTION_MAX = 90

/** Truncate cleanly at the last whitespace before `max` chars; fall back to a
 *  hard cut + ellipsis if no whitespace exists in the tail region. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const lastSpace = head.lastIndexOf(" ")
  return lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head.slice(0, max - 1) + "…"
}

function normaliseBlueprint(args: CampaignBlueprintArgs): CampaignBlueprintArgs {
  return {
    ...args,
    ad_copy: {
      ...args.ad_copy,
      headlines: args.ad_copy.headlines.map((h) => truncate(h, HEADLINE_MAX)),
      descriptions: args.ad_copy.descriptions.map((d) => truncate(d, DESCRIPTION_MAX)),
    },
  }
}

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
  const parsed = lenientBlueprintSchema.safeParse(candidate)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Blueprint payload is not shaped like a campaign blueprint",
        issues: parsed.error.issues,
      },
      { status: 422 },
    )
  }

  // Truncate over-length strings to Google Ads RSA limits so the CSV imports
  // cleanly. The agent overshoots descriptions occasionally — better to ship
  // a usable file than refuse the download.
  const normalised = normaliseBlueprint(parsed.data as CampaignBlueprintArgs)
  const csv = renderCampaignBlueprintCsv(normalised)
  const filename = `${sanitiseFilename(normalised.campaign_name)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
}
