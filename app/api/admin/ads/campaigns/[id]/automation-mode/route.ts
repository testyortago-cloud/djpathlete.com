// app/api/admin/ads/campaigns/[id]/automation-mode/route.ts
// Admin-only. Updates the per-campaign automation_mode override (auto_pilot
// / co_pilot / advisory). Plan 1.3's apply path consults this to decide
// whether to skip, queue, or auto-apply each recommendation.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { setAutomationMode } from "@/lib/db/google-ads-campaigns"
import { googleAdsAutomationModeSchema } from "@/lib/validators/ads"

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await ctx.params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = googleAdsAutomationModeSchema.safeParse(
    (body as { mode?: unknown })?.mode,
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "mode must be auto_pilot | co_pilot | advisory" },
      { status: 400 },
    )
  }

  try {
    await setAutomationMode(id, parsed.data)
    return NextResponse.json({ ok: true, mode: parsed.data })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "update failed" },
      { status: 500 },
    )
  }
}
