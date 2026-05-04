// app/api/admin/ads/recommendations/[id]/approve/route.ts
// Admin approves AND applies in one step (Plan 1.3). Approval flips status
// to 'approved', then the apply path attempts the Google Ads mutation. On
// success the rec ends at 'applied' with an automation_log entry; on failure
// it ends at 'failed' with the failure_reason set so the admin sees why.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { applyRecommendation } from "@/lib/ads/apply"
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

  // Step 1: flip pending → approved (atomic; refuses if already non-pending).
  try {
    await approveRecommendation(id, session.user.id)
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "approve failed" },
      { status: 500 },
    )
  }

  // Step 2: attempt apply. applyRecommendation never throws — it captures the
  // failure into automation_log and updates rec status to failed if needed.
  const result = await applyRecommendation(id, {
    mode: "co_pilot",
    actor: session.user.id,
  })

  return NextResponse.json({ ok: result.applied, result })
}
