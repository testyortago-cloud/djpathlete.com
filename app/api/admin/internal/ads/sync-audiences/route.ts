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
import { syncGa4Audiences } from "@/lib/ads/ga4-audiences"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await syncCustomerMatchAudiences()
    // Plan 1.5e — refresh the GA4 / remarketing audience cache in the same
    // pass so the admin's audiences page shows current sizes for every list.
    // Soft-fail isolated from Customer Match: a GA4-pull error doesn't void
    // the Customer Match push that just succeeded.
    let ga4: Awaited<ReturnType<typeof syncGa4Audiences>> | null = null
    try {
      ga4 = await syncGa4Audiences()
    } catch (gaErr) {
      console.error("[sync-audiences] GA4 audience pull failed:", gaErr)
    }
    return NextResponse.json({ ok: true, ...result, ga4 })
  } catch (error) {
    console.error("[sync-audiences] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "audience sync failed" },
      { status: 500 },
    )
  }
}
