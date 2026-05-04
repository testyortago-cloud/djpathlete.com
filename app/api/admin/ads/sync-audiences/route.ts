// app/api/admin/ads/sync-audiences/route.ts
// Admin "Sync now" button — runs the audience worker on demand. Same engine
// the daily Firebase Scheduler uses. Helpful for testing the config without
// waiting for the next 07:00 UTC tick.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { syncCustomerMatchAudiences } from "@/lib/ads/audiences"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const result = await syncCustomerMatchAudiences()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "sync failed" },
      { status: 500 },
    )
  }
}
