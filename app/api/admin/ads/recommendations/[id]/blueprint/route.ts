// app/api/admin/ads/recommendations/[id]/blueprint/route.ts
// Returns the new_campaign blueprint as JSON for the modal preview. Same
// lenient shape-only validation as the CSV endpoint — strings get
// truncated to Google Ads RSA limits before render. Admin-only.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getRecommendationById } from "@/lib/db/google-ads-recommendations"
import type { CampaignBlueprintArgs } from "@/lib/ads/agent/decision-schema"

interface RouteContext {
  params: Promise<{ id: string }>
}

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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const lastSpace = head.lastIndexOf(" ")
  return lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head.slice(0, max - 1) + "…"
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params

  const rec = await getRecommendationById(id)
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (rec.recommendation_type !== "new_campaign") {
    return NextResponse.json(
      { error: "Recommendation is not a campaign blueprint" },
      { status: 400 },
    )
  }

  const payload = (rec.payload ?? {}) as Record<string, unknown>
  const candidate = (payload.args as Record<string, unknown> | undefined) ?? payload
  const parsed = lenientBlueprintSchema.safeParse(candidate)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Blueprint payload is malformed", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const blueprint: CampaignBlueprintArgs = {
    ...(parsed.data as CampaignBlueprintArgs),
    ad_copy: {
      ...parsed.data.ad_copy,
      headlines: parsed.data.ad_copy.headlines.map((h) => truncate(h, HEADLINE_MAX)),
      descriptions: parsed.data.ad_copy.descriptions.map((d) =>
        truncate(d, DESCRIPTION_MAX),
      ),
    },
  }

  return NextResponse.json({ blueprint, reasoning: rec.reasoning })
}
