// lib/analytics/sections/client-risk-daily.ts
// Surfaces today's high/medium risk clients from client_engagement_snapshots
// inside the Daily Brief. Returns null when the snapshot is empty or no
// client cleared the medium threshold — keeping the section hidden when
// there's nothing worth flagging.

import { createServiceRoleClient } from "@/lib/supabase"
import { topRiskTodayWithClients } from "@/lib/db/client-engagement"
import type { DailyClientRiskPayload } from "@/types/coach-emails"

const MAX_ROWS = 5

export async function buildDailyClientRisk(): Promise<DailyClientRiskPayload | null> {
  const supabase = createServiceRoleClient()
  try {
    const rows = await topRiskTodayWithClients(supabase, MAX_ROWS)
    if (rows.length === 0) return null

    const items = rows.map((row) => ({
      name: row.client_name,
      tier: row.risk_tier as "medium" | "high",
      score: row.risk_score,
      reasons: row.reasons.slice(0, 3),
    }))
    const high = items.filter((i) => i.tier === "high").length
    const medium = items.filter((i) => i.tier === "medium").length

    return { totalHigh: high, totalMedium: medium, items }
  } catch (err) {
    console.error(`[client-risk-daily] failed:`, err)
    return null
  }
}
