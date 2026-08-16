// POST /api/admin/internal/funnel-window
//
// Daily. Takes offline any published funnel whose run window has closed and
// whose owner asked for that.
//
// THE ONLY WATCHDOG IN THE APP THAT CHANGES WHAT A VISITOR SEES. The five
// insights crons write a snapshot row; this one unpublishes a page. So:
//
//  - the selection rule is a pure function with its own tests, and this route
//    performs the write and nothing else;
//  - the flag defaults FALSE, like every other cron here, and the funnel detail
//    screen states plainly when a funnel is set to auto-close while the job is
//    switched off, rather than implying an automation that is not running;
//  - every close writes an audit row, because "who took my camp page down" must
//    have an answer that is not "nobody knows".

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { listFunnels, updateFunnel } from "@/lib/db/funnels"
import { selectFunnelsToClose } from "@/lib/automation/funnel-window-closer"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_funnel_window_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  // Every funnel, both kinds: the run-window columns live on `funnels`, and a
  // landing page carrying one means the same thing a funnel's does.
  const funnels = await listFunnels()
  const closing = selectFunnelsToClose(funnels, new Date())

  const closed: string[] = []
  const failed: { id: string; error: string }[] = []

  for (const id of closing) {
    try {
      await updateFunnel(id, { status: "draft" })
      closed.push(id)
      const funnel = funnels.find((candidate) => candidate.id === id)
      await recordAudit({
        action: "funnel.auto_offline",
        category: "automation",
        // Explicit actor, not the `auth()` fallback: there is no session on a
        // cron, and without this the row would be attributed to "anonymous".
        actor: { id: null, email: null, role: "system" },
        target: { type: "funnel", id, label: funnel?.name ?? id },
        metadata: { ends_at: funnel?.ends_at ?? null, slug: funnel?.slug ?? null },
      })
    } catch (error) {
      // One funnel failing must not strand the rest. A camp that stays live an
      // extra day is a smaller problem than every other camp staying live.
      console.error(`[funnel-window] could not take ${id} offline:`, error)
      failed.push({ id, error: (error as Error).message })
    }
  }

  // A non-empty `failed` is a 500 so the health scanner sees a failed run —
  // reporting ok:true with a failure list would make the watchdog blind to it.
  return NextResponse.json(
    { ok: failed.length === 0, considered: funnels.length, closed, failed },
    { status: failed.length === 0 ? 200 : 500 },
  )
}
