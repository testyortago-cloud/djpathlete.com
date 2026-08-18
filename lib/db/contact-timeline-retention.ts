// lib/db/contact-timeline-retention.ts (Next.js-side twin)
// Mirror of functions/src/lib/contact-timeline-retention.ts. functions/ has
// rootDir: "src" and cannot import from lib/, so the shape is duplicated —
// keep these two files in sync. See lib/db/cron-runs.ts /
// functions/src/lib/cron-runs.ts for the same convention.
//
// contact_timeline_events.metadata carries raw funnel payload PII (names,
// emails, whatever the form collected) with no retention. This scrubs the
// PII and stamps scrubbed_at while leaving the row — kind, source and
// occurred_at — intact. It does NOT delete: "this person first arrived via
// the funnel in March" is what the timeline exists to answer and carries no
// personal data.

import type { SupabaseClient } from "@supabase/supabase-js"

export async function scrubContactTimeline(
  supabase: SupabaseClient,
  days: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("contact_timeline_events")
    .update({ metadata: {}, scrubbed_at: new Date().toISOString() }, { count: "exact" })
    .lt("occurred_at", cutoff)
    .is("scrubbed_at", null)
  if (error) throw error
  return count ?? 0
}
