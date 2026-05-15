// POST /api/admin/internal/revenue-digest
// Weekly Monday-morning revenue digest. Aggregates subscription/payment
// state into a revenue_snapshots row and emails the result to COACH_EMAIL.

import { NextRequest, NextResponse } from "next/server"
import { createElement } from "react"
import { z } from "zod"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { resend, FROM_EMAIL } from "@/lib/resend"
import {
  fetchRevenueInputs,
  insertSnapshot,
  isoMondayOf,
  latestSnapshot,
} from "@/lib/db/revenue-snapshots"
import { aggregateRevenue } from "@/lib/automation/revenue-aggregator"
import { RevenueDigest } from "@/components/emails/RevenueDigest"
import type { RevenueSnapshot } from "@/types/database"

export const runtime = "nodejs"
export const maxDuration = 120

const BodySchema = z
  .object({
    to: z.string().email().optional(),
    dryRun: z.boolean().optional(),
    referenceDate: z.string().datetime().optional(),
  })
  .default({})

async function renderEmail(snapshot: RevenueSnapshot, dashboardUrl: string): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(createElement(RevenueDigest, { snapshot, dashboardUrl }))
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const { to: toOverride, dryRun, referenceDate: referenceIso } = parsed.data

  const gate = await isCronSkipped({
    enabledKey: "cron_revenue_digest_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) {
    return NextResponse.json({ skipped: gate.reason }, { status: 200 })
  }

  const supabase = createServiceRoleClient()
  const referenceDate = referenceIso ? new Date(referenceIso) : new Date()
  const week_of = isoMondayOf(referenceDate)

  let snapshot: RevenueSnapshot
  try {
    const inputs = await fetchRevenueInputs(supabase)
    const aggregated = aggregateRevenue(inputs)
    await insertSnapshot(supabase, { week_of, raw: {}, ...aggregated })
    const saved = await latestSnapshot(supabase)
    if (!saved) throw new Error("snapshot insert succeeded but read-back returned null")
    snapshot = saved
  } catch (err) {
    console.error("[revenue-digest] aggregation failed:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3050"
  const dashboardUrl = `${baseUrl}/admin/insights/revenue`
  const html = await renderEmail(snapshot, dashboardUrl)
  const subject = `Weekly revenue digest — week of ${snapshot.week_of}`

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, subject, snapshot, html }, { status: 200 })
  }

  const recipient = toOverride ?? process.env.COACH_EMAIL
  if (!recipient) {
    return NextResponse.json({ error: "COACH_EMAIL not configured" }, { status: 500 })
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 })
  }

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: recipient,
    subject,
    html,
  })
  if (error) {
    console.error("[revenue-digest] resend error:", error)
    return NextResponse.json({ error: error.message ?? "Resend send failed" }, { status: 502 })
  }

  return NextResponse.json(
    { ok: true, sentTo: recipient, subject, snapshot_week: snapshot.week_of },
    { status: 200 },
  )
}
