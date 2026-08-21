// app/api/admin/internal/content-schedule-due/route.ts
// Cron endpoint hit by contentScheduleCron every 5 minutes. Guarded by the
// shared bearer token (INTERNAL_CRON_TOKEN). Delegates to runContentSchedule().

import { NextRequest, NextResponse } from "next/server"
import { runContentSchedule } from "@/lib/content-schedule/run-due"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "contentScheduleCron")
  try {
    const result = await runContentSchedule()
    await logCronEnd(supabase, runId, "success", { ...result })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    await logCronEnd(supabase, runId, "failed", { message: (error as Error).message })
    console.error("[content-schedule-due] Error:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "Unknown content-schedule error" },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
