// app/api/admin/ads/recommendations/[id]/apply/route.ts
// Retry endpoint for recs that landed in 'failed' status (apply attempt
// errored). Re-runs the apply path; on success status flips to applied.
// Distinct from approve so the admin can selectively retry without
// changing approval semantics.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { applyRecommendation } from "@/lib/ads/apply"
import { getRecommendationById } from "@/lib/db/google-ads-recommendations"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params

  const rec = await getRecommendationById(id)
  if (!rec) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 })
  }
  // Only allow retry from failed (apply errored) or approved (manual queue).
  if (rec.status !== "failed" && rec.status !== "approved") {
    return NextResponse.json(
      { error: `Cannot apply from status '${rec.status}' (expected failed | approved)` },
      { status: 409 },
    )
  }

  const result = await applyRecommendation(id, {
    mode: "co_pilot",
    actor: session.user.id,
  })
  return NextResponse.json({ ok: result.applied, result })
}
