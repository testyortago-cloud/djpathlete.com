// app/api/admin/ads/campaigns/[id]/generate-copy/route.ts
// Admin-triggered ad copy generation for one campaign. Produces
// 'add_ad_variant' recommendations that land in the approval queue.
// Skips Performance Max campaigns — their asset model is handled by Plan
// 1.5g (AI Agent loops). Final URL is optional in the body; defaults to
// the production darrenjpaul.com root.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { runAdCopyForCampaign } from "@/lib/ads/ad-copy"

const BodySchema = z
  .object({
    finalUrl: z.string().url().optional(),
    maxAdGroups: z.number().int().positive().max(20).optional(),
  })
  .default({})

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params

  const raw = await request.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  try {
    const result = await runAdCopyForCampaign(id, parsed.data)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[ads/generate-copy] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "ad copy generation failed" },
      { status: 500 },
    )
  }
}
