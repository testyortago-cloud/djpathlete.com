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
import { listBusinesses } from "@/lib/db/businesses"
import { selectFunnelsToClose } from "@/lib/automation/funnel-window-closer"
import { recordAudit } from "@/lib/audit/record"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Same shell as pipeline-reconcile (see the comment there, audit §4 #9):
  // started BEFORE the flag gate, so a cron that ships OFF by default (this
  // one does — see the file header) still proves its schedule is alive
  // instead of writing no cron_runs row at all, which read exactly like a
  // dead scheduler to the health scanner. The skipped branch logs "success"
  // with `detail: { skipped: reason }` rather than leaving the row "running"
  // or marking it "failed" — being off is not a failure.
  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "funnelWindowCron")

  const gate = await isCronSkipped({
    enabledKey: "cron_funnel_window_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) {
    await logCronEnd(supabase, runId, "success", { skipped: gate.reason })
    return NextResponse.json({ skipped: gate.reason })
  }

  try {
    // EVERY BUSINESS, NOT ONE. This route has no session and no Host to
    // resolve a single tenant from — but its job is every tenant's expired
    // funnels, and this is the only watchdog that changes what a visitor sees
    // (see the file header). Resolving one tenant here would leave a SECOND
    // tenant's expired camp page published forever while this cron reports
    // success every night. `lib/automation/pipeline-reconcile.ts` already
    // faces the identical no-session problem and solves it the same way —
    // iterate every business, isolate one business's failure from the rest —
    // so this follows that shape rather than inventing a second one.
    // `activeOnly: true` for the same reason `pipeline-reconcile.ts` uses it:
    // a paused business is not operating (see lib/tenancy/resolve.ts's own
    // comment on the same filter), so there is nothing running that needs its
    // page taken offline on a schedule.
    const businesses = await listBusinesses({ activeOnly: true })

    const closed: string[] = []
    const failed: { id: string; error: string }[] = []
    let considered = 0

    for (const business of businesses) {
      let funnels: Awaited<ReturnType<typeof listFunnels>>
      try {
        // Every funnel, both kinds: the run-window columns live on `funnels`,
        // and a landing page carrying one means the same thing a funnel's does.
        funnels = await listFunnels(business.id)
      } catch (error) {
        // ONE BUSINESS'S READ FAILING MUST NOT STRAND EVERY OTHER BUSINESS —
        // the same reasoning as the per-funnel guard below, one level up, and
        // the reason this cron exists to iterate at all. Filed under the
        // business id, since no funnel was ever read to file it under.
        console.error(`[funnel-window] could not list funnels for business ${business.id}:`, error)
        failed.push({ id: business.id, error: (error as Error).message })
        continue
      }

      considered += funnels.length
      const closing = selectFunnelsToClose(funnels, new Date())

      for (const id of closing) {
        try {
          await updateFunnel(business.id, id, { status: "draft" })
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
    }

    await logCronEnd(supabase, runId, failed.length === 0 ? "success" : "failed", {
      considered,
      closed,
      failed,
    })

    // A non-empty `failed` is a 500 so the health scanner sees a failed run —
    // reporting ok:true with a failure list would make the watchdog blind to it.
    return NextResponse.json(
      { ok: failed.length === 0, considered, closed, failed },
      { status: failed.length === 0 ? 200 : 500 },
    )
  } catch (err) {
    // Belt-and-braces: listBusinesses throwing outright (e.g. a DB outage,
    // before any business-scoped work could even start) is not caught by the
    // per-business try/catch above, which only guards the loop body. Without
    // this, that failure mode would leave the exact same blind spot the flag
    // gate did — a run with no cron_runs row to show for it.
    const message = err instanceof Error ? err.message : String(err)
    console.error("[funnel-window] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
