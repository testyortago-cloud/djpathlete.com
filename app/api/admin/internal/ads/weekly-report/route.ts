// app/api/admin/internal/ads/weekly-report/route.ts
// Internal route hit by the sendWeeklyAdsReport Firebase Function every
// Monday at 13:00 UTC (06:00 PT). Composes the Weekly Google Ads Report
// and sends it via Resend. Guarded by INTERNAL_CRON_TOKEN.
//
// Optional body: { to?: email, dryRun?: boolean, rangeEnd?: ISO datetime }.
// dryRun returns the rendered HTML without sending — useful for inspecting
// the email locally via curl.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { resend, FROM_EMAIL } from "@/lib/resend"
import { buildWeeklyAdsReport } from "@/lib/ads/weekly-report"

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
    return NextResponse.json(
      { error: "COACH_EMAIL not configured and no 'to' override provided" },
      { status: 500 },
    )
  }

  try {
    const rangeEnd = rangeEndIso ? new Date(rangeEndIso) : undefined
    const report = await buildWeeklyAdsReport({ rangeEnd })

    if (dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          subject: report.subject,
          html: report.html,
          rangeStart: report.rangeStart.toISOString(),
          rangeEnd: report.rangeEnd.toISOString(),
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
      console.error("[weekly-ads-report] Resend error:", error)
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
    console.error("[weekly-ads-report] Unexpected error:", err)
    return NextResponse.json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 })
  }
}
