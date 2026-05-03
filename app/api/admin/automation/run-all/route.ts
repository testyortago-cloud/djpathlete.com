// app/api/admin/automation/run-all/route.ts
// Admin-only "Run all" endpoint. Triggers every cron job in the catalog
// sequentially via /api/admin/automation/trigger. Per-job toggles are
// respected — disabled jobs return paused: true and don't burn cost.
// Global automation_paused also short-circuits each job.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { CRON_CATALOG, type CronJobName } from "@/lib/cron-catalog"

interface JobResult {
  jobName: CronJobName
  status: number
  ok: boolean
  body: unknown
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }

  const url = new URL(request.url)
  const triggerUrl = `${url.protocol}//${url.host}/api/admin/automation/trigger`

  // Forward the admin's cookie so the trigger route's auth() call sees the
  // same admin session. Without this, the upstream POST would 403.
  const cookie = request.headers.get("cookie") ?? ""

  const results: JobResult[] = []
  for (const job of CRON_CATALOG) {
    try {
      const upstream = await fetch(triggerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ jobName: job.name }),
      })
      const body = await upstream.json().catch(() => null)
      results.push({
        jobName: job.name,
        status: upstream.status,
        ok: upstream.ok,
        body,
      })
    } catch (err) {
      results.push({
        jobName: job.name,
        status: 502,
        ok: false,
        body: { error: (err as Error).message ?? "Unknown error" },
      })
    }
  }

  const successCount = results.filter((r) => r.ok).length
  return NextResponse.json(
    {
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
    },
    { status: 200 },
  )
}
