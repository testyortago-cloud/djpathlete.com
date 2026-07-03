// POST /api/admin/internal/session-no-show
// Hit hourly by the sessionNoShowScanCron Firebase function. Marks scheduled
// sessions whose end time + buffer has passed without a check-in as `no_show`.
// (Phase D hooks the no-show fee charge here, guarded by flag + config + card.)

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { listScheduledPending } from "@/lib/db/scheduled-sessions"
import { scanNoShows, markNoShow } from "@/lib/services/session-schedule"
import { chargeNoShowFee } from "@/lib/services/session-fees"

export const runtime = "nodejs"
export const maxDuration = 300

export const SESSION_NO_SHOW_CRON_KEY = "cron_session_no_show_enabled"
const BUFFER_MINUTES = 60

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({ enabledKey: SESSION_NO_SHOW_CRON_KEY, defaultEnabled: false })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const now = new Date()
  const toDate = now.toISOString().slice(0, 10)
  const pending = await listScheduledPending(toDate)
  const byId = new Map(pending.map((s) => [s.id, s]))
  const ids = scanNoShows(pending, now, BUFFER_MINUTES)

  let marked = 0
  let errors = 0
  for (const id of ids) {
    try {
      await markNoShow(id, null)
      marked += 1
      // Best-effort no-show fee (fully guarded: flag + amount + saved card).
      const s = byId.get(id)
      if (s) await chargeNoShowFee(s)
    } catch (err) {
      errors += 1
      console.error(`[session-no-show] failed for ${id}:`, err)
    }
  }

  return NextResponse.json({ scanned: pending.length, marked, errors }, { status: 200 })
}
