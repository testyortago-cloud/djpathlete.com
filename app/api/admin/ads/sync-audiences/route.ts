// app/api/admin/ads/sync-audiences/route.ts
// Admin "Sync now" button — runs the audience worker on demand. Same engine
// the daily Firebase Scheduler uses. Helpful for testing the config without
// waiting for the next 07:00 UTC tick.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { syncCustomerMatchAudiences } from "@/lib/ads/audiences"
import { syncGa4Audiences } from "@/lib/ads/ga4-audiences"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const result = await syncCustomerMatchAudiences()
    let ga4: Awaited<ReturnType<typeof syncGa4Audiences>> | null = null
    try {
      ga4 = await syncGa4Audiences()
    } catch (gaErr) {
      console.error("[sync-audiences:admin] GA4 audience pull failed:", gaErr)
    }
    return NextResponse.json({ ok: true, ...result, ga4 })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "sync failed" },
      { status: 500 },
    )
  }
}
