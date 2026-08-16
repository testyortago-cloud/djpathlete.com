// POST /api/admin/internal/automation-health
// Daily 08:00 UTC. Scans Firestore ai_jobs (failures + pending) + Supabase
// cron_runs (last success per watched cron) and writes one
// automation_health_snapshots row. On severity='critical', emails
// COACH_EMAIL.

import { NextRequest, NextResponse } from "next/server"
import { createElement } from "react"
import { getSetting, isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { resend, FROM_EMAIL } from "@/lib/resend"
import { lastFailurePerCron, lastSuccessPerCron } from "@/lib/db/cron-runs"
import {
  EXPECTED_CRONS,
  scanAutomationHealth,
} from "@/lib/automation/automation-health-scanner"
import { AutomationHealthAlert } from "@/components/emails/AutomationHealthAlert"

export const runtime = "nodejs"
export const maxDuration = 120

const ONE_HOUR_MS = 3600_000
const TWENTY_FOUR_H_MS = 24 * ONE_HOUR_MS

async function renderAlert(args: Parameters<typeof AutomationHealthAlert>[0]): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(createElement(AutomationHealthAlert, args))
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_automation_health_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const firestore = getAdminFirestore()
  const now = Date.now()

  // 1) ai_jobs failure counts by type in last 24h
  const ai_jobs_failed_by_type_24h: Record<string, number> = {}
  let ai_jobs_pending_over_1h = 0
  try {
    const failedSnap = await firestore
      .collection("ai_jobs")
      .where("status", "==", "failed")
      .where("updatedAt", ">=", new Date(now - TWENTY_FOUR_H_MS))
      .get()
    failedSnap.forEach((doc) => {
      const type = (doc.data().type as string | undefined) ?? "unknown"
      ai_jobs_failed_by_type_24h[type] = (ai_jobs_failed_by_type_24h[type] ?? 0) + 1
    })

    const pendingSnap = await firestore
      .collection("ai_jobs")
      .where("status", "in", ["pending", "running"])
      .where("createdAt", "<=", new Date(now - ONE_HOUR_MS))
      .get()
    ai_jobs_pending_over_1h = pendingSnap.size
  } catch (err) {
    console.error("[automation-health] Firestore read failed:", err)
  }

  // 2) Per-cron last success, and — for the crons that write cron_runs at all
  //    — their last failure. The scanner reads the failure only for crons with
  //    no success on record, to tell a cron the deploy never reached from one
  //    that runs and loses. Asking about the 11 non-reporters would be 11
  //    round trips guaranteed to answer null.
  const [last_success_per_cron, last_failure_per_cron] = await Promise.all([
    lastSuccessPerCron(
      supabase,
      EXPECTED_CRONS.map((c) => c.name),
    ),
    lastFailurePerCron(
      supabase,
      EXPECTED_CRONS.filter((c) => c.reports_to_cron_runs).map((c) => c.name),
    ),
  ])

  // 2b) Gate state. A cron the operator switched off is dormant, not silent —
  // without this the "never succeeded" check would nag forever about crons
  // that are off on purpose.
  const gated = EXPECTED_CRONS.filter((c) => c.enabled_flag)
  const gateStates = await Promise.all(
    gated.map(async (c) => ({
      name: c.name,
      enabled: await getSetting<boolean>(c.enabled_flag!, c.enabled_flag_default ?? false),
    })),
  )
  const disabled_crons = gateStates.filter((g) => !g.enabled).map((g) => g.name)

  // 3) Score
  const scored = scanAutomationHealth({
    ai_jobs_failed_by_type_24h,
    ai_jobs_pending_over_1h,
    last_success_per_cron,
    last_failure_per_cron,
    disabled_crons,
  })

  // 4) Persist
  const insertPayload = {
    ai_jobs_failed_24h: ai_jobs_failed_by_type_24h,
    ai_jobs_pending_over_1h,
    silent_crons: scored.silent_crons,
    alert_severity: scored.alert_severity,
    alert_summary: scored.alert_summary,
    raw: {
      expected_crons: EXPECTED_CRONS.map((c) => c.name),
      // Recorded so a quiet snapshot can be read back as "off" vs "healthy".
      disabled_crons,
    },
  }
  const { error: insertErr } = await supabase
    .from("automation_health_snapshots")
    .insert(insertPayload)
  if (insertErr) {
    console.error("[automation-health] insert failed:", insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // 5) Email if critical
  let emailed = false
  if (scored.alert_severity === "critical") {
    const baseUrl =
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
    const dashboardUrl = `${baseUrl}/admin/insights/automation-health`
    const recipient = process.env.COACH_EMAIL
    if (recipient && process.env.RESEND_API_KEY) {
      const html = await renderAlert({
        severity: "critical",
        summary: scored.alert_summary ?? "Automation health critical",
        ai_jobs_failed_24h: ai_jobs_failed_by_type_24h,
        ai_jobs_pending_over_1h,
        silent_crons: scored.silent_crons,
        dashboardUrl,
      })
      const { error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient,
        subject: `[critical] Automation health — ${new Date().toISOString().slice(0, 10)}`,
        html,
      })
      if (error) console.error("[automation-health] resend error:", error)
      else emailed = true
    }
  }

  return NextResponse.json(
    { ok: true, severity: scored.alert_severity, summary: scored.alert_summary, emailed },
    { status: 200 },
  )
}
