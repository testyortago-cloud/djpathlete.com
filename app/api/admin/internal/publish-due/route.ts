// app/api/admin/internal/publish-due/route.ts
// Cron endpoint hit by Vercel Cron every 5 minutes. Guarded by a shared
// bearer token (INTERNAL_CRON_TOKEN env var). Delegates the actual
// publishing loop to runScheduledPublish(), which bootstraps plugins
// from platform_connections credentials and publishes any due posts.

import { NextRequest, NextResponse } from "next/server"
import { runScheduledPublish } from "@/lib/social/publish-runner"

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runScheduledPublish()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[publish-due] Error:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "Unknown publish-due error" },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
