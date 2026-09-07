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

export interface SequenceReportRow {
  id: string
  key: string
  name: string
  description: string | null
  status: string
  trigger_source: string | null
  entered: number
  buckets: Record<OutcomeBucket, number>
  contactsWithoutEmailConsent: number
}

// TEMPORARY — replaced by the real implementation in Task 3.
async function contactsWithEmailConsent(_businessId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("contact_id, granted, occurred_at")
    .eq("business_id", _businessId)
    .eq("channel", "email")
    .in("contact_id", ids)
    .order("occurred_at", { ascending: false })
  if (error) throw new Error(`contactsWithEmailConsent: ${(error as { message?: string }).message}`)
  const seen = new Set<string>()
  const granted = new Set<string>()
  for (const row of (data ?? []) as { contact_id: string; granted: boolean }[]) {
    if (seen.has(row.contact_id)) continue
    seen.add(row.contact_id)
    if (row.granted) granted.add(row.contact_id)
  }
  return granted
}

/**
 * One row per sequence, with its outcome tally.
 *
 * PostgREST cannot GROUP BY and this feature takes no migration, so there is no
 * RPC to call: the counts are computed here, over one row per run.
 *
 * THE CEILING, stated honestly: that is every run of every sequence in memory
 * at once. At today's 73 it is free, and it stays comfortable into the low tens
 * of thousands. Past that this wants a database-side GROUP BY behind an RPC.
 * Written down so the next person meets a documented threshold instead of a
 * mystery.
 *
 * Every sequence gets a row whether or not anybody has entered it. Eight of the
 * nine sequences in production have never run; a report that only listed the
 * ones with runs would be a nearly empty page that looks like a broken read.
 */
export async function sequenceReport(businessId: string): Promise<SequenceReportRow[]> {
  const supabase = getClient()

  const { data: sequences, error: seqError } = await supabase
    .from("sequences")
    .select("id, key, name, description, status, trigger_source")
    .eq("business_id", businessId)
    .order("name", { ascending: true })
  // Throws rather than returning []: an empty page for a failed read would tell
  // the operator this business has no sequences, which is not true.
  if (seqError) throw new Error(`sequenceReport sequences: ${(seqError as { message?: string }).message}`)

  const { data: runs, error: runsError } = await supabase
    .from("sequence_runs")
    .select("sequence_id, contact_id, status, exit_reason")
    .eq("business_id", businessId)
  if (runsError) throw new Error(`sequenceReport runs: ${(runsError as { message?: string }).message}`)

  type RunRow = { sequence_id: string; contact_id: string; status: string; exit_reason: string | null }
  const runRows = (runs ?? []) as RunRow[]

  const tallies = new Map<string, { entered: number; buckets: Record<OutcomeBucket, number> }>()
  const contactsBySequence = new Map<string, Set<string>>()
  for (const run of runRows) {
    let tally = tallies.get(run.sequence_id)
    if (!tally) {
      tally = { entered: 0, buckets: emptyBuckets() }
      tallies.set(run.sequence_id, tally)
    }
    tally.entered += 1
    tally.buckets[bucketForRun(run.status, run.exit_reason)] += 1

    let contacts = contactsBySequence.get(run.sequence_id)
    if (!contacts) {
      contacts = new Set()
      contactsBySequence.set(run.sequence_id, contacts)
    }
    contacts.add(run.contact_id)
  }

  const allContactIds = [...new Set(runRows.map((r) => r.contact_id))]
  const consented = await contactsWithEmailConsent(businessId, allContactIds)

  type SequenceRow = {
    id: string
    key: string
    name: string
    description: string | null
    status: string
    trigger_source: string | null
  }

  return ((sequences ?? []) as SequenceRow[]).map((sequence) => {
    const tally = tallies.get(sequence.id)
    const contacts = contactsBySequence.get(sequence.id) ?? new Set<string>()
    let without = 0
    for (const contactId of contacts) if (!consented.has(contactId)) without += 1
    return {
      ...sequence,
      entered: tally?.entered ?? 0,
      buckets: tally?.buckets ?? emptyBuckets(),
      contactsWithoutEmailConsent: without,
    }
  })
}
