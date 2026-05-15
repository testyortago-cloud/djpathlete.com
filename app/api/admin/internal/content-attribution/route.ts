// POST /api/admin/internal/content-attribution
// Weekly Sunday-night job. Joins blog_posts × gsc_query_daily ×
// marketing_attribution × payments and persists one row per published post.

import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  fetchJoinerInput,
  upsertAttributionSnapshots,
} from "@/lib/db/content-attribution"
import { joinContentToRevenue } from "@/lib/automation/content-revenue-joiner"
import { isoMondayOf } from "@/lib/db/revenue-snapshots"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: "cron_content_attribution_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  try {
    const input = await fetchJoinerInput(supabase)
    const rows = joinContentToRevenue(input)
    const week_of = isoMondayOf(new Date())
    await upsertAttributionSnapshots(supabase, week_of, rows)
    const withRevenue = rows.filter((r) => r.revenue_attributed_cents > 0).length
    return NextResponse.json(
      {
        ok: true,
        week_of,
        posts_processed: rows.length,
        posts_with_revenue: withRevenue,
      },
      { status: 200 },
    )
  } catch (err) {
    console.error("[content-attribution] failed:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
