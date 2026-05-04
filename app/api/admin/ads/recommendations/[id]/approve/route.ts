// app/api/admin/ads/recommendations/[id]/approve/route.ts
// Admin-only. Flips a 'pending' recommendation to 'approved' and stamps the
// approver. The actual Google Ads write-back lives in Plan 1.3 — for now
// this just queues the rec for application.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { approveRecommendation } from "@/lib/db/google-ads-recommendations"

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params

  try {
    const rec = await approveRecommendation(id, session.user.id)
    return NextResponse.json({ ok: true, recommendation: rec })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "approve failed" },
      { status: 500 },
    )
  }
}
