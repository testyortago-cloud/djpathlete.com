// app/api/admin/internal/ads/sync-audiences/route.ts
// Internal cron endpoint hit by syncCustomerMatchAudiences daily.
// Computes desired membership per active user list, hashes emails,
// pushes the delta to Google Ads via OfflineUserDataJob. Soft-skips when
// GOOGLE_ADS_DEVELOPER_TOKEN is unset — local mirror remains untouched
// and the next post-cutover run pushes everything as additions.
//
// Bearer-token gated via INTERNAL_CRON_TOKEN.

import { NextRequest, NextResponse } from "next/server"
import { syncCustomerMatchAudiences } from "@/lib/ads/audiences"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await syncCustomerMatchAudiences()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[sync-audiences] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "audience sync failed" },
      { status: 500 },
    )
  }
}
