// lib/db/sequence-reporting.ts — the read behind /admin/sequences.
//
// Separate from lib/db/sequences.ts, which is the ENGINE's IO: claiming due
// runs, recording sends, advancing positions. That module is on the hot path of
// a cron that runs every five minutes. This one is a human-facing report that
// runs when somebody opens a page. Keeping them apart means a reporting change
// cannot slow the tick down, and a tick change cannot silently alter a number
// on a screen.

import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

/**
 * What happened to a person who entered a sequence.
 *
 * ONE axis, derived from TWO database columns, because neither column answers
 * the question on its own:
 *
 *   - `sequence_runs.status` is active | completed | exited | failed
 *   - `exit_reason` is only ever populated when status = 'exited'
 *
 * So "they finished the whole sequence" is a STATUS (`completed`, with no exit
 * reason at all), while "they bought" is a REASON. A screen that showed only
 * exit reasons would lose every finisher; one that showed only statuses could
 * not tell a purchase from an unsubscribe.
 *
 * `other` is not defensive padding. `exitRun` takes a plain `string`, so the
 * set of reasons that can reach the database is not closed by the type system
 * — `lib/automation/sequence-tick.ts` already writes one ("suppressed") that
 * `SequenceExitReason` does not declare. A sixth added tomorrow lands in
 * `other` and is VISIBLE on the screen, instead of quietly making the columns
 * stop adding up to the total.
 */
export type OutcomeBucket =
  | "in_progress"
  | "bought"
  | "booked"
  | "opted_out"
  | "finished"
  | "failed"
  | "other"

export const OUTCOME_BUCKETS: readonly OutcomeBucket[] = [
  "in_progress",
  "bought",
  "booked",
  "opted_out",
  "finished",
  "failed",
  "other",
] as const

/**
 * Every exit reason that can reach the database today, found by grepping the
 * helper that performs the verb rather than the function expected to call it —
 * the exits live in the event handlers, not in `decideStep`:
 *
 *   payment      app/api/stripe/webhook/route.ts:223
 *   booking      lib/bookings/ingest.ts:309
 *   unsubscribed lib/lead-engine/unsubscribe.ts:95
 *   sms_stop     app/api/webhooks/twilio/inbound/route.ts:278
 *   suppressed   lib/automation/sequence-tick.ts:113   <- not in the union
 *
 * Grouped here rather than switched on inline so that the three ways of saying
 * "stop contacting me" stay one column on the list. The detail page splits
 * them again, because an email unsubscribe, a texted STOP and "was already on
 * the do-not-contact list before we reached them" are three different things.
 */
const OPTED_OUT_REASONS = new Set(["unsubscribed", "sms_stop", "suppressed"])

export function bucketForRun(status: string, exitReason: string | null): OutcomeBucket {
  if (status === "active") return "in_progress"
  if (status === "completed") return "finished"
  if (status === "failed") return "failed"
  if (status === "exited") {
    if (exitReason === "payment") return "bought"
    if (exitReason === "booking") return "booked"
    if (exitReason && OPTED_OUT_REASONS.has(exitReason)) return "opted_out"
  }
  return "other"
}

/** A fresh zeroed tally. Fresh per call — two sequences must not share one. */
export function emptyBuckets(): Record<OutcomeBucket, number> {
  return {
    in_progress: 0,
    bought: 0,
    booked: 0,
    opted_out: 0,
    finished: 0,
    failed: 0,
    other: 0,
  }
}
