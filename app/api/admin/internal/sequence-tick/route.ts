// POST /api/admin/internal/sequence-tick
// Every-5-minutes job. Claims due sequence_runs, decides the next action for
// each via the pure `decideStep` core, and executes it (send, advance,
// defer, exit, complete, or fail). Shape copied from
// app/api/admin/internal/inbox-sla/route.ts. All the actual work lives in
// `runSequenceTick` (lib/automation/sequence-tick-runner.ts) — this route is
// the auth/gate/logging shell around it.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { runSequenceTick } from "@/lib/automation/sequence-tick-runner"
import { BusinessNotConfiguredError } from "@/lib/lead-engine/email"

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
    enabledKey: "cron_sequence_tick_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "sequenceTickCron")
  try {
    const summary = await runSequenceTick()

    // A CONFIGURATION FAULT IS INVISIBLE FROM THE OUTSIDE. The runs defer, the
    // route answers 200, and nothing sends — which is the 31 August failure
    // wearing a quieter face. Before the fault-classification change those 73
    // runs were destroyed loudly; deferring instead fixes the damage but would
    // remove the alarm along with it, and nobody found out either way.
    //
    // So a tick that recorded even one configuration fault reports FAILED,
    // even when other runs in the same batch sent successfully: a batch half
    // blocked by a provider misconfiguration is not a healthy tick.
    // automation-health-scanner (daily 08:00 UTC, emails on `critical`)
    // already lists this cron, so this is the line that reaches a human.
    //
    // THE REASON MUST NOT NAME ONE CAUSE. `config_faults` counted only
    // rejected sends when it was written; Task 5 widened it to include
    // `PipelineNotConfiguredError`, which is a missing pipeline and has
    // nothing to do with email. A sentence that blames the email provider
    // sends the operator to check a provider that is healthy, they call it a
    // false alarm, and the run is destroyed ~100 minutes later — see the
    // `isConfigFault` block in lib/automation/sequence-tick-runner.ts, which
    // rests the whole value of this classification on a human fixing the
    // setting inside that window. So the sentence names both settings and
    // says out loud that the runs DO die if nobody acts.
    //
    // Task 10 (multi-coach ops): `runSequenceTick` now loops over active
    // businesses internally and isolates a business whose preflight/claim
    // loop threw into `summary.failures` rather than throwing (unless EVERY
    // business failed — see that function's doc comment). That must ALSO
    // mark this tick's one cron_runs row failed, same reasoning as
    // config_faults above: a business failing silently every tick behind
    // others succeeding is exactly what lastSuccessPerCron would hide.
    const businessFailures = summary.failures ?? []
    if ((summary.config_faults ?? 0) > 0 || businessFailures.length > 0) {
      const messages: string[] = []
      if ((summary.config_faults ?? 0) > 0) {
        messages.push(
          `${summary.config_faults} configuration fault(s): a setting is missing or wrong. Check the email sender, and that this business has a pipeline set up. Those runs are on hold and retrying. They fail for good in roughly 100 minutes if nobody fixes it.`,
        )
      }
      if (businessFailures.length > 0) {
        messages.push(
          `${businessFailures.length} business(es) failed: ${businessFailures.map((f) => f.businessId).join(", ")}`,
        )
      }
      await logCronEnd(supabase, runId, "failed", { message: messages.join("; "), ...summary })
      return NextResponse.json({ ok: true, ...summary })
    }

    await logCronEnd(supabase, runId, "success", summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[sequence-tick] failed:", err)
    // Fix round 1: when EVERY active business failed, runSequenceTick
    // rethrows the last one's error but attaches the full `failures[]` to it
    // first (see that function's doc comment) — so the cron_runs row still
    // names every failing business, not just whichever one happened to be
    // rethrown.
    const attachedFailures = (err as { failures?: Array<{ businessId: string; error: string }> } | null)?.failures
    await logCronEnd(supabase, runId, "failed", attachedFailures ? { message, failures: attachedFailures } : { message })

    // An unconfigured business_settings row answers 200, not 500. The caller
    // is a scheduler: a 500 makes it retry a misconfiguration that no retry
    // can fix, forever. The cron_runs row above is still marked `failed`, so
    // the automation-health watchdog surfaces it to a human — which is the
    // only thing that can actually resolve it. Nothing was claimed and
    // nothing was failed (runSequenceTick preflights before claiming).
    if (err instanceof BusinessNotConfiguredError) {
      return NextResponse.json({ error: message }, { status: 200 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
