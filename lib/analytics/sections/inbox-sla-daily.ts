// lib/analytics/sections/inbox-sla-daily.ts
// Pulls today's freshest inbox_sla_snapshots row. Returns null when no
// snapshot exists or the fetch was degraded — keeps the Daily Pulse
// section hidden when there's nothing meaningful to show.

import { createServiceRoleClient } from "@/lib/supabase"
import { latestInboxSnapshot } from "@/lib/db/inbox-sla"
import type { DailyInboxSlaPayload } from "@/types/coach-emails"

export async function buildDailyInboxSla(): Promise<DailyInboxSlaPayload | null> {
  const supabase = createServiceRoleClient()
  try {
    const snap = await latestInboxSnapshot(supabase)
    if (!snap || snap.fetch_status !== "ok") return null
    // Only surface when there's actually something to flag.
    if (
      snap.unread_count === 0 &&
      snap.awaiting_reply_over_24h === 0 &&
      (snap.mean_response_minutes_7d ?? 0) < 1440
    ) {
      return null
    }
    return {
      unreadCount: snap.unread_count,
      awaitingReplyOver24h: snap.awaiting_reply_over_24h,
      awaitingReplyOver48h: snap.awaiting_reply_over_48h,
      meanResponseMinutes7d: snap.mean_response_minutes_7d,
      oldestUnanswered: snap.oldest_unanswered.slice(0, 3).map((o) => ({
        contactName: o.contact_name,
        hoursWaiting: o.hours_waiting,
        snippet: o.snippet,
      })),
    }
  } catch (err) {
    console.error("[inbox-sla-daily] failed:", err)
    return null
  }
}
