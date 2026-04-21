// app/api/admin/ai/voice-drift/route.ts
// GET — returns the most recent voice-drift flags (last 7 days by default).
// Read-only. Mirror of /api/admin/ai/insights for auth.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listRecentVoiceDriftFlags } from "@/lib/db/voice-drift-flags"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }

  try {
    const since = new Date(Date.now() - SEVEN_DAYS_MS)
    const flags = await listRecentVoiceDriftFlags({
      since,
      severity: ["medium", "high"],
      limit: 50,
    })

    const lastScanAt = flags.length > 0 ? flags[0].scanned_at : null

    return NextResponse.json({ flags, lastScanAt })
  } catch (error) {
    console.error("[voice-drift] Error:", error)
    return NextResponse.json({ error: "Failed to fetch voice drift flags." }, { status: 500 })
  }
}
