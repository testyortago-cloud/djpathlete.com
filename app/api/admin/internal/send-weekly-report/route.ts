// app/api/admin/internal/send-weekly-report/route.ts
// Internal route hit by the sendWeeklyContentReport Firebase Function every
// Friday at 17:00 Central. Composes the Weekly Content Report and sends it
// via Resend. Guarded by INTERNAL_CRON_TOKEN.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { resend, FROM_EMAIL } from "@/lib/resend"
import { buildWeeklyReport } from "@/lib/analytics/weekly-report"
import { isCronSkipped } from "@/lib/db/system-settings"

const BodySchema = z
  .object({
    to: z.string().email().optional(),
    dryRun: z.boolean().optional(),
    rangeEnd: z.string().datetime().optional(),
  })
  .default({})

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const { to: toOverride, dryRun, rangeEnd: rangeEndIso } = parsed.data
  const recipient = toOverride ?? process.env.COACH_EMAIL
  if (!recipient) {
    return NextResponse.json({ error: "COACH_EMAIL not configured and no 'to' override provided" }, { status: 500 })
  }

  try {
    const gate = await isCronSkipped({
      enabledKey: "cron_weekly_report_enabled",
      defaultEnabled: true,
    })
    if (gate.skipped) {
      console.log(`[send-weekly-report] skipped — ${gate.reason}`)
      return NextResponse.json({ ok: true, paused: true, reason: gate.reason }, { status: 200 })
    }

    const rangeEnd = rangeEndIso ? new Date(rangeEndIso) : undefined
    const report = await buildWeeklyReport({ rangeEnd })

    if (dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          subject: report.subject,
          html: report.html,
          rangeStart: report.rangeStart.toISOString(),
          rangeEnd: report.rangeEnd.toISOString(),
          payload: {
            ...report.payload,
            rangeStart: report.payload.rangeStart.toISOString(),
            rangeEnd: report.payload.rangeEnd.toISOString(),
          },
        },
        { status: 200 },
      )
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 })
    }

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipient,
      subject: report.subject,
      html: report.html,
    })

    if (error) {
      console.error("[send-weekly-report] Resend error:", error)
      return NextResponse.json({ error: error.message ?? "Resend send failed" }, { status: 502 })
    }

    return NextResponse.json(
      {
        ok: true,
        sentTo: recipient,
        subject: report.subject,
        rangeStart: report.rangeStart.toISOString(),
        rangeEnd: report.rangeEnd.toISOString(),
      },
      { status: 200 },
    )
  } catch (err) {
    console.error("[send-weekly-report] Unexpected error:", err)
    return NextResponse.json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 })
  }
}
