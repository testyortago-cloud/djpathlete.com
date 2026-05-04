// app/api/admin/internal/ads/process-conversions/route.ts
// Internal cron endpoint hit by the processGoogleAdsConversions Firebase
// Function every 15 minutes. Drains pending conversion uploads + adjustments.
// Soft-skips gracefully when GOOGLE_ADS_DEVELOPER_TOKEN isn't configured —
// rows stay pending until the live cutover.
//
// Bearer-token gated via INTERNAL_CRON_TOKEN.

import { NextRequest, NextResponse } from "next/server"
import { processPendingConversionUploads } from "@/lib/ads/conversions"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await processPendingConversionUploads()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[process-conversions] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "drain failed" },
      { status: 500 },
    )
  }
}
