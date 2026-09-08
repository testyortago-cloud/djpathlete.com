// lib/db/sequence-reporting.ts — the read behind /admin/sequences.
//
// Separate from lib/db/sequences.ts, which is the ENGINE's IO: claiming due
// runs, recording sends, advancing positions. That module is on the hot path of
// a cron that runs every five minutes. This one is a human-facing report that
// runs when somebody opens a page. Keeping them apart means a reporting change
// cannot slow the tick down, and a tick change cannot silently alter a number
// on a screen.

import { createServiceRoleClient } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/db/paginate"

function getClient() {
  return createServiceRoleClient()
}

/**
 * `fetchAllRows` throws the bare PostgREST message, which does not say WHICH of
 * this module's reads failed. Every read here labels its own failures, so the
 * label is re-attached rather than lost. The error still THROWS — it is never
 * turned into an empty result, which would render as "nobody entered".
 */
async function labelled<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run()
  } catch (err) {
    throw new Error(`${label}: ${(err as Error).message}`)
  }
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
 * `SequenceExitReason` does not declare. A reason added tomorrow lands in
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
 * Every exit reason that can reach the database today.
 *
 * Found by grepping the helper that performs the verb rather than the function
 * expected to call it — the exits live in the event handlers, not in
 * `decideStep`. Written by TypeScript:
 *
 *   payment      app/api/stripe/webhook/route.ts:223
 *   booking      lib/bookings/ingest.ts:309
 *   unsubscribed lib/lead-engine/unsubscribe.ts:95
 *   sms_stop     app/api/webhooks/twilio/inbound/route.ts:278
 *   suppressed   lib/automation/sequence-tick.ts:113   <- not in the union
 *
 * AND TWO WRITTEN BY SQL, which a TypeScript-only grep does not find — this
 * list was wrong for exactly that reason once already:
 *
 *   merged_into_survivor      supabase/migrations/00238_merge_contacts_carries_tags.sql
 *   superseded_by_merged_run  supabase/migrations/00238_merge_contacts_carries_tags.sql
 *
 * Both are set inside the `merge_contacts` plpgsql function, which is called
 * automatically from lib/db/contacts.ts during identity resolution — not from a
 * button — so they can appear on this screen without anybody having done
 * anything that looks like a merge. When you go looking for the writer of a
 * reason, grep the migrations as well as the source.
 *
 * The three "stop contacting me" reasons are grouped here rather than switched
 * on inline so they stay one column on the list. The detail page splits them
 * again, because an email unsubscribe, a texted STOP and "was already on the
 * do-not-contact list before we reached them" are three different things.
 *
 * The two merge reasons deliberately do NOT get their own bucket: they land in
 * `other`, and the detail page names them in words. They are bookkeeping, not
 * an outcome the follow-up produced.
 *
 * A THIRD reason written by SQL, added by migration 00256's `save_sequence_steps`:
 *
 *   sequence_edited   supabase/migrations/00256_sequence_management.sql
 *
 * Written when an edit to the step list removes a person's current step out
 * from under them. This ALSO deliberately gets no bucket of its own — it lands
 * in `other`, never in `finished`. The status column for one of these rows is
 * `exited`, not `completed`, so `bucketForRun` cannot reach the `finished`
 * branch for it no matter what this set contains; that separation is the
 * point, not an accident, because reporting an edited-away follow-up as one
 * that reached the end is the exact lie this whole feature exists to prevent.
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
  // Everything else exited lands here — including "sequence_edited", the two
  // merge reasons, and any reason not yet invented. NEVER "finished": a run
  // that exited (this branch) never reached `completed` (the branch above),
  // so an edited-away follow-up cannot be mistaken for one that ran its
  // course.
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
  status: string
  trigger_source: string | null
  entered: number
  buckets: Record<OutcomeBucket, number>
  contactsWithoutEmailConsent: number
}

export interface SequenceReport {
  rows: SequenceReportRow[]
  /**
   * DISTINCT people across the whole tenant with no recorded permission to
   * email — NOT the sum of the per-row numbers. Somebody in two sequences is
   * one person, and the sentence under the table says "people". Summing the
   * rows counted them twice.
   */
  contactsWithoutEmailConsent: number
}

/**
 * How many contact ids go into one `.in(...)` clause.
 *
 * PostgREST puts the whole list in the query STRING, so an unchunked `.in()`
 * over every contact in every sequence grows the URL without limit. Past
 * roughly 450 uuids it clears 16 KB and the request fails outright — which on
 * this screen means the whole page falls through to the admin error boundary,
 * not a missing number. 200 is the chunk size lib/db/bookkeeping.ts already
 * uses for the same reason.
 */
const CONTACT_ID_CHUNK = 200

/**
 * Which of these contacts have said yes to email, most recently.
 *
 * CONSENT IS THE NEWEST ROW PER CONTACT WITH `granted = true`, not "a row
 * exists". `contact_consents` is an append-only trail: granting, revoking and
 * re-granting all add rows, so an `exists` check would report a REVOKED
 * consent as a granted one. Of the two ways to get this wrong, that is the
 * dangerous one.
 *
 * The tiebreak matches `hasConsent` in lib/db/contact-consents.ts exactly —
 * `occurred_at desc, created_at desc` — so the report and the engine cannot
 * disagree about one person. `id desc` is appended only as a paging tiebreaker
 * (see below); it never changes which row wins for a contact whose rows carry
 * distinct timestamps.
 *
 * Bulk, unlike `hasConsent`, which issues one query per contact: this is a
 * report over every contact in every sequence, and the per-contact version
 * would be 73 round trips on the current data — 73 being the number of contacts
 * that are in a sequence, which is the population this walks, not the 169 rows
 * in the whole contacts table.
 *
 * The walk KEEPS THE FIRST ROW SEEN per contact and skips the rest, which is
 * only correct because the query is ordered newest-first. The dedup and the
 * ordering are one mechanism; either alone is a bug. Chunking cannot disturb it
 * because the chunks are disjoint sets of contact ids: every row for one person
 * is in exactly one chunk, still in order.
 */
export async function contactsWithEmailConsent(
  businessId: string,
  contactIds: string[],
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set()

  const supabase = getClient()
  type ConsentRow = { contact_id: string; granted: boolean }

  const seen = new Set<string>()
  const granted = new Set<string>()

  for (let i = 0; i < contactIds.length; i += CONTACT_ID_CHUNK) {
    const chunk = contactIds.slice(i, i + CONTACT_ID_CHUNK)
    // Paged as well as chunked: one contact can have many consent rows, so the
    // trail for 200 people can exceed PostgREST's ~1000-row cap on its own.
    // Throws: "could not read the consent table" must not render as "nobody has
    // consented". null and [] are different answers.
    const rows = await labelled("contactsWithEmailConsent", () =>
      fetchAllRows<ConsentRow>(
        (from, to) =>
          supabase
            .from("contact_consents")
            .select("contact_id, granted, occurred_at")
            .eq("business_id", businessId)
            .eq("channel", "email")
            .in("contact_id", chunk)
            .order("occurred_at", { ascending: false })
            .order("created_at", { ascending: false })
            // Unique tiebreaker: rows tied on both timestamps could otherwise
            // repeat or vanish across a .range() page boundary.
            .order("id", { ascending: false })
            .range(from, to) as never,
      ),
    )

    for (const row of rows) {
      if (seen.has(row.contact_id)) continue
      seen.add(row.contact_id)
      if (row.granted) granted.add(row.contact_id)
    }
  }

  return granted
}

/**
 * One row per sequence, with its outcome tally.
 *
 * PostgREST cannot GROUP BY and this feature takes no migration, so there is no
 * RPC to call: the counts are computed here, over one row per run.
 *
 * THE CEILING, stated honestly, and corrected. The first version of this read
 * had no `.range()` on it at all, and PostgREST silently caps a plain
 * `.select()` at about 1000 rows — no error, no warning. So the real ceiling was
 * never memory: past 1000 runs in a tenant, the numbers on this screen would
 * simply have been WRONG. Worse, `sequenceDetail` reads runs for ONE sequence,
 * so it would have gone on being right while the list under-counted, and a
 * sequence could read "Nobody has entered this one yet" on the list and
 * "Entered 600" on its own page one click later — with neither read ordered, a
 * different sequence could lose on every page load. It is now paged with
 * `fetchAllRows`, so the row count is no longer a correctness limit.
 *
 * What is left is a MEMORY ceiling: one row per run of every sequence, held at
 * once. At today's 73 that is free, and it stays comfortable into the low tens
 * of thousands. Past that this wants a database-side GROUP BY behind an RPC.
 *
 * Every sequence gets a row whether or not anybody has entered it. Eight of the
 * nine sequences in production have never run; a report that only listed the
 * ones with runs would be a nearly empty page that looks like a broken read.
 */
export async function sequenceReport(businessId: string): Promise<SequenceReport> {
  const supabase = getClient()

  // Not paged: one row per sequence, nine of them in production, and a coach
  // who has authored a thousand sequences is not a problem this repo has.
  const { data: sequences, error: seqError } = await supabase
    .from("sequences")
    .select("id, key, name, status, trigger_source")
    .eq("business_id", businessId)
    .order("name", { ascending: true })
  // Throws rather than returning []: an empty page for a failed read would tell
  // the operator this business has no sequences, which is not true.
  if (seqError) throw new Error(`sequenceReport sequences: ${(seqError as { message?: string }).message}`)

  type RunRow = { sequence_id: string; contact_id: string; status: string; exit_reason: string | null }
  const runRows = await labelled("sequenceReport runs", () =>
    fetchAllRows<RunRow>(
      (from, to) =>
        supabase
          .from("sequence_runs")
          .select("sequence_id, contact_id, status, exit_reason")
          .eq("business_id", businessId)
          // Paging an UNORDERED read can repeat and skip rows across .range()
          // windows, so the read that got paged also got an order.
          .order("id", { ascending: true })
          .range(from, to) as never,
    ),
  )

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

  // The tenant-wide figure, counted over the DISTINCT ids rather than summed
  // from the rows below. One person in two sequences is one person.
  let withoutConsentTotal = 0
  for (const contactId of allContactIds) if (!consented.has(contactId)) withoutConsentTotal += 1

  type SequenceRow = {
    id: string
    key: string
    name: string
    status: string
    trigger_source: string | null
  }

  const rows = ((sequences ?? []) as SequenceRow[]).map((sequence) => {
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

  return { rows, contactsWithoutEmailConsent: withoutConsentTotal }
}

export interface SequenceRunRowForReport {
  id: string
  contactId: string
  contactName: string | null
  contactEmail: string | null
  enteredAt: string
  completedAt: string | null
  bucket: OutcomeBucket
  /**
   * The RAW reason, kept alongside the bucket on purpose. The list collapses
   * three reasons into "opted out"; the detail page splits them again, because
   * an email unsubscribe, a texted STOP and "was already on the do-not-contact
   * list" are three different things an operator would act on differently.
   */
  exitReason: string | null
  /**
   * Why nothing was sent, on a run that failed. Written only by `failRun`, so
   * it is null on every run that did not fail.
   *
   * Carried all the way to the screen deliberately. On production today the
   * only sequence with any runs at all has 73 of them and every one failed; a
   * bare red 73 under "Something went wrong" reads as a bug in the report. The
   * recorded reason is the only answer the database has, and "the darrenjpaul.com
   * domain is not verified" is something a coach can act on.
   */
  lastError: string | null
}

export interface SequenceDetail extends SequenceReportRow {
  /**
   * Kept here although the LIST no longer selects it — the detail page has a
   * standing comment on why it is not rendered yet, and a future step editor
   * will want it.
   */
  description: string | null
  stepCount: number
  runs: SequenceRunRowForReport[]
  /** May exceed `runs.length` — the pager needs the real total. */
  totalRuns: number
}

export const DETAIL_PAGE_SIZE = 100

/**
 * One sequence, its tally, and the individual people in it.
 *
 * Returns `null` — not an empty report — when no sequence with this key belongs
 * to this business, so the page can answer 404. An empty report would tell an
 * operator that a sequence they can name has nobody in it, when the truth is
 * that it is somebody else's.
 */
export async function sequenceDetail(
  businessId: string,
  key: string,
  opts?: { limit?: number; offset?: number },
): Promise<SequenceDetail | null> {
  const limit = opts?.limit ?? DETAIL_PAGE_SIZE
  const offset = opts?.offset ?? 0
  const supabase = getClient()

  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, key, name, description, status, trigger_source")
    .eq("key", key)
    .eq("business_id", businessId)
    .maybeSingle()
  if (seqError) throw new Error(`sequenceDetail sequence: ${(seqError as { message?: string }).message}`)
  if (!sequence) return null

  const row = sequence as {
    id: string
    key: string
    name: string
    description: string | null
    status: string
    trigger_source: string | null
  }

  type TallyRow = { status: string; exit_reason: string | null; contact_id: string }
  const tallyRows = await labelled("sequenceDetail tally", () =>
    fetchAllRows<TallyRow>(
      (from, to) =>
        supabase
          .from("sequence_runs")
          .select("status, exit_reason, contact_id")
          .eq("business_id", businessId)
          .eq("sequence_id", row.id)
          // Same reason as the list read: an unordered .range() walk can repeat
          // and skip rows, and this one feeds the pager's total.
          .order("id", { ascending: true })
          .range(from, to) as never,
    ),
  )

  const buckets = emptyBuckets()
  for (const r of tallyRows) buckets[bucketForRun(r.status, r.exit_reason)] += 1

  const { data: pageRuns, error: pageError } = await supabase
    .from("sequence_runs")
    .select(
      "id, contact_id, enrolled_at, completed_at, status, exit_reason, last_error, contacts(name, email)",
    )
    .eq("business_id", businessId)
    .eq("sequence_id", row.id)
    // Newest first, and NOT optional: .range() over an unordered result set can
    // repeat and skip rows between pages. `id` breaks ties on enrolled_at for
    // the same reason.
    .order("enrolled_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1)
  if (pageError) throw new Error(`sequenceDetail runs: ${(pageError as { message?: string }).message}`)

  type JoinedRun = {
    id: string
    contact_id: string
    enrolled_at: string
    completed_at: string | null
    status: string
    exit_reason: string | null
    last_error: string | null
    contacts: { name: string | null; email: string | null } | null
  }

  const runs: SequenceRunRowForReport[] = ((pageRuns ?? []) as unknown as JoinedRun[]).map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    // A missing join is not a reason to hide a person from the list. It renders
    // without a name rather than not at all.
    contactName: r.contacts?.name ?? null,
    contactEmail: r.contacts?.email ?? null,
    enteredAt: r.enrolled_at,
    completedAt: r.completed_at,
    bucket: bucketForRun(r.status, r.exit_reason),
    exitReason: r.exit_reason,
    lastError: r.last_error,
  }))

  // Not paged: a sequence is a handful of steps, and the longest one in
  // production has eight.
  const { data: steps, error: stepsError } = await supabase
    .from("sequence_steps")
    .select("id")
    .eq("business_id", businessId)
    .eq("sequence_id", row.id)
  if (stepsError) throw new Error(`sequenceDetail steps: ${(stepsError as { message?: string }).message}`)

  const contactIds = [...new Set(tallyRows.map((r) => r.contact_id))]
  const consented = await contactsWithEmailConsent(businessId, contactIds)
  let without = 0
  for (const id of contactIds) if (!consented.has(id)) without += 1

  return {
    ...row,
    entered: tallyRows.length,
    buckets,
    contactsWithoutEmailConsent: without,
    stepCount: (steps ?? []).length,
    runs,
    totalRuns: tallyRows.length,
  }
}
