// app/api/admin/internal/ads/agent-strategist/route.ts
// Internal endpoint hit by runAgentStrategist Wednesday at 13:00 UTC.
// Generates the weekly memo, renders the email, sends via Resend, and
// stamps email_sent_at on the memo row. Bearer-token gated.

import { NextRequest, NextResponse } from "next/server"
import { createElement } from "react"
import { z } from "zod"
import { resend, FROM_EMAIL } from "@/lib/resend"
import { buildStrategistMemo } from "@/lib/ads/agent"
import { setAgentMemoEmailSent } from "@/lib/db/google-ads-agent-memos"
import { WeeklyAgentMemo } from "@/components/emails/WeeklyAgentMemo"

const BodySchema = z
  .object({
    to: z.string().email().optional(),
    dryRun: z.boolean().optional(),
  })
  .default({})

async function renderEmail(element: React.ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

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

  const { to: toOverride, dryRun } = parsed.data
  const recipient = toOverride ?? process.env.COACH_EMAIL
  if (!recipient) {
    return NextResponse.json(
      { error: "COACH_EMAIL not configured and no 'to' override provided" },
      { status: 500 },
    )
  }

  try {
    const memo = await buildStrategistMemo({ source: "scheduled" })

    const baseUrl =
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
    const dashboardUrl = `${baseUrl}/admin/ads/agent/${memo.id}`
    const html = await renderEmail(
      createElement(WeeklyAgentMemo, {
        subject: memo.subject,
        weekOf: memo.week_of,
        sections: memo.sections,
        dashboardUrl,
        baseUrl,
      }),
    )

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        memoId: memo.id,
        subject: memo.subject,
        html,
      })
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 })
    }

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipient,
      subject: memo.subject,
      html,
    })
    if (error) {
      console.error("[agent-strategist] Resend error:", error)
      return NextResponse.json({ error: error.message ?? "Resend send failed" }, { status: 502 })
    }

    await setAgentMemoEmailSent(memo.id, recipient)

    return NextResponse.json({
      ok: true,
      memoId: memo.id,
      sentTo: recipient,
      subject: memo.subject,
    })
  } catch (err) {
    console.error("[agent-strategist] Unexpected error:", err)
    return NextResponse.json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 })
  }
}
