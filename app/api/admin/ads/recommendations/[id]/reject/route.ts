// app/api/admin/ads/recommendations/[id]/reject/route.ts
// Admin-only. Flips a 'pending' recommendation to 'rejected' so it stops
// surfacing in the queue. Idempotent against the existing pending guard.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { rejectRecommendation } from "@/lib/db/google-ads-recommendations"

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
    const rec = await rejectRecommendation(id, session.user.id)
    return NextResponse.json({ ok: true, recommendation: rec })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "reject failed" },
      { status: 500 },
    )
  }
}
