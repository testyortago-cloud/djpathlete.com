// app/api/admin/internal/ads/recommendations/route.ts
// Internal endpoint hit by the Functions-side Google Ads sync orchestrator
// after each account's data refresh completes. Guarded by INTERNAL_CRON_TOKEN.
// Body: { customer_id: string }. Generates recommendations for that one
// account and persists them as 'pending'. Also expires stale (>14d) rows.

import { NextRequest, NextResponse } from "next/server"
import { runRecommendationsForCustomer } from "@/lib/ads/recommendations"
import { runAutoPilotApply } from "@/lib/ads/apply"
import { expireStaleRecommendations } from "@/lib/db/google-ads-recommendations"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { customer_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body.customer_id !== "string" || body.customer_id.length === 0) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 })
  }

  try {
    const expired = await expireStaleRecommendations()
    const result = await runRecommendationsForCustomer(body.customer_id)
    // Plan 1.3: after fresh recs land, scan for auto_pilot-eligible ones and
    // apply them. Only negative keywords with confidence ≥ 0.8 in auto_pilot
    // campaigns; capped at 10/run to bound damage.
    const autoPilot = await runAutoPilotApply(body.customer_id)
    return NextResponse.json({ ok: true, expired, ...result, auto_pilot: autoPilot })
  } catch (error) {
    console.error("[ads/recommendations] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "recommendations run failed" },
      { status: 500 },
    )
  }
}
