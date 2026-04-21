// app/api/admin/internal/send-daily-pulse/route.ts
// Internal route hit by the sendDailyPulse Firebase Function every weekday
// at 07:00 Central. Composes the Daily Pulse and sends it via Resend.
// Guarded by INTERNAL_CRON_TOKEN.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { resend, FROM_EMAIL } from "@/lib/resend"
import { buildDailyPulse } from "@/lib/analytics/daily-pulse"
import { isAutomationPaused } from "@/lib/db/system-settings"

const BodySchema = z
  .object({
    to: z.string().email().optional(),
    dryRun: z.boolean().optional(),
    forceMonday: z.boolean().optional(),
    referenceDate: z.string().datetime().optional(),
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

  const { to: toOverride, dryRun, forceMonday, referenceDate: referenceIso } = parsed.data
  const recipient = toOverride ?? process.env.COACH_EMAIL
  if (!recipient) {
    return NextResponse.json({ error: "COACH_EMAIL not configured and no 'to' override provided" }, { status: 500 })
  }

  try {
    if (await isAutomationPaused()) {
      return NextResponse.json({ ok: true, paused: true }, { status: 200 })
    }

    const referenceDate = referenceIso ? new Date(referenceIso) : undefined
    const pulse = await buildDailyPulse({ referenceDate, forceMonday })

    if (dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          subject: pulse.subject,
          html: pulse.html,
          isMondayEdition: pulse.isMondayEdition,
          pipeline: pulse.pipeline,
          trendingTopicsCount: pulse.trendingTopics.length,
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
      subject: pulse.subject,
      html: pulse.html,
    })

    if (error) {
      console.error("[send-daily-pulse] Resend error:", error)
      return NextResponse.json({ error: error.message ?? "Resend send failed" }, { status: 502 })
    }

    return NextResponse.json(
      {
        ok: true,
        sentTo: recipient,
        subject: pulse.subject,
        isMondayEdition: pulse.isMondayEdition,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error("[send-daily-pulse] Unexpected error:", err)
    return NextResponse.json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 })
  }
}
