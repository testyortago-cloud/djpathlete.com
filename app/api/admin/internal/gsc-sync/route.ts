// POST /api/admin/internal/gsc-sync
// Hit nightly by the gscSyncCron Firebase scheduled function. Pulls 3 days
// of GSC data (yesterday, 2 days ago, 3 days ago) and upserts them into
// gsc_query_daily. Guarded by INTERNAL_CRON_TOKEN + isCronSkipped.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, setSetting } from "@/lib/db/system-settings"
import { getGscProperty } from "@/lib/db/gsc-properties"
import { upsertGscRows } from "@/lib/db/gsc-query-daily"
import { searchAnalyticsQuery, OAuthBrokenError } from "@/lib/gsc/client"

const GSC_ROW_LIMIT = 25000
const SYNC_WINDOW_DAYS = 3

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_gsc_sync_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const prop = await getGscProperty()
  if (!prop) return NextResponse.json({ skipped: "not_connected" }, { status: 200 })

  const synced: Record<string, number> = {}
  const errors: Array<{ date: string; message: string }> = []
  let totalRows = 0

  for (let i = 1; i <= SYNC_WINDOW_DAYS; i++) {
    const date = isoDateNDaysAgo(i)
    try {
      const resp = await searchAnalyticsQuery({
        startDate: date,
        endDate: date,
        dimensions: ["query", "page"],
        rowLimit: GSC_ROW_LIMIT,
      })
      const rows = (resp.rows ?? []).map((r) => ({
        date,
        query: r.keys[0],
        page: r.keys[1],
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        position: r.position,
      }))
      const upserted = await upsertGscRows(rows)
      synced[date] = upserted
      totalRows += upserted
    } catch (err) {
      if (err instanceof OAuthBrokenError) {
        await setSetting("gsc_oauth_broken", true)
        return NextResponse.json(
          { error: "OAuth broken — coach must reconnect", date },
          { status: 500 },
        )
      }
      errors.push({ date, message: (err as Error).message ?? "unknown" })
    }
  }

  return NextResponse.json({ synced, totalRows, errors }, { status: 200 })
}
