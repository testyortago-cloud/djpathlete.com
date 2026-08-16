// lib/automation/funnel-window-closer.ts — takes a finished camp offline.
//
// Pure, and deliberately so. This is the only watchdog in the app whose action
// is DESTRUCTIVE FROM THE VISITOR'S SIDE: the other five write a snapshot row,
// while this one unpublishes a page that was accepting registrations. Nobody
// watches a 04:00 cron, so the selection rule has to be testable without a
// database and every condition has to be exercised by a row that differs from a
// qualifying one by exactly one field.
//
// It answers WHICH funnels, never performs the write. The route does that, so
// this file cannot take anything offline by being imported.

import { hasWindowClosed } from "@/lib/funnels/run-window"
import type { Funnel } from "@/types/database"

/**
 * The ids to take offline, given every funnel and the current instant.
 *
 * Three conditions, all required:
 *
 * 1. `status === "published"` — a draft is already offline, and an archived
 *    funnel has been dealt with deliberately. Re-writing either would churn
 *    `updated_at` and reorder the owner's list for no reason.
 * 2. `auto_offline_at_end` — the owner asked for this. Without the opt-in, an
 *    end date is a note on a card.
 * 3. The window has closed, INCLUSIVE of its final instant — see
 *    `hasWindowClosed`. A camp ending at midnight is still running at midnight.
 *
 * An unparseable `ends_at` closes nothing: `hasWindowClosed` returns false for
 * it rather than letting a NaN comparison decide whether a live page goes down.
 */
export function selectFunnelsToClose(funnels: Funnel[], now: Date): string[] {
  return funnels
    .filter(
      (funnel) =>
        funnel.status === "published" &&
        funnel.auto_offline_at_end &&
        hasWindowClosed(funnel.ends_at, now),
    )
    .map((funnel) => funnel.id)
}
